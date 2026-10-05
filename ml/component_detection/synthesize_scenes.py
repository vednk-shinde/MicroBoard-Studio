"""Build webcam-like training scenes: components pasted into real room/people backgrounds.

Why: the source photos are product shots where the part fills the frame on a plain background. A webcam
frame is the opposite (a small part, held up in a room, a person behind it, soft focus, noise, poor light),
and the v1 model trained only on product shots scores an Arduino held up to a webcam at 8%.

For every split separately (no leakage between splits):
- objects: each labelled box of that split, cropped. When the crop is on a plain background, the
  background is removed (colour distance from the border colour), otherwise the rectangle is pasted.
- backgrounds: that split's hard-negative images (people, rooms, posters, desks).
- 1-3 objects per scene, class-balanced, 8-45% of the frame width, rotated up to 25 degrees, brightness
  matched to the background; then webcam degradation of the whole frame (blur, down/up-scaling, noise,
  JPEG artefacts, low light, colour cast).

The output dataset = the original dataset + synthetic scenes added to train and val, plus a separate
`scene_test` split (from test-split objects and backgrounds) to measure performance on webcam-like scenes.

Usage:
    python ml/component_detection/synthesize_scenes.py <source_dataset_dir> <out_dataset_dir> [--train 2600 --val 300 --test 300]
"""

from __future__ import annotations

import argparse
import random
import shutil
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
import yaml

OUT_SIZE = (960, 720)  # typical webcam aspect ratio (4:3)
PLAIN_BORDER_STD = 22.0  # border pixels this uniform count as a plain background


def read_labels(path: Path) -> list[tuple[int, float, float, float, float]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            cls, x, y, w, h = line.split()
            rows.append((int(cls), float(x), float(y), float(w), float(h)))
    return rows


def cut_object(image: np.ndarray, box: tuple[float, float, float, float]) -> np.ndarray | None:
    """Return the boxed object as BGRA (alpha = object mask, or the full rectangle)."""
    height, width = image.shape[:2]
    x, y, w, h = box
    x1, y1 = int((x - w / 2) * width), int((y - h / 2) * height)
    x2, y2 = int((x + w / 2) * width), int((y + h / 2) * height)
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(width, x2), min(height, y2)
    if x2 - x1 < 24 or y2 - y1 < 24:
        return None
    crop = image[y1:y2, x1:x2]
    alpha = np.full(crop.shape[:2], 255, np.uint8)

    border = np.concatenate([crop[0], crop[-1], crop[:, 0], crop[:, -1]]).astype(np.float32)
    if border.std(axis=0).mean() < PLAIN_BORDER_STD:
        distance = np.linalg.norm(crop.astype(np.float32) - np.median(border, axis=0), axis=2)
        mask = (distance > 35).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
        if count > 1:
            keep = np.zeros_like(mask)
            biggest = stats[1:, cv2.CC_STAT_AREA].max()
            for index in range(1, count):
                if stats[index, cv2.CC_STAT_AREA] >= 0.05 * biggest:
                    keep[labels == index] = 255
            # Fill holes so dark parts inside the object stay opaque.
            filled = keep.copy()
            contours, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(filled, contours, -1, 255, thickness=cv2.FILLED)
            if filled.mean() / 255 > 0.15:  # a believable object, not a few specks
                alpha = cv2.GaussianBlur(filled, (5, 5), 0)
    return np.dstack([crop, alpha])


def rotate(rgba: np.ndarray, degrees: float) -> np.ndarray:
    height, width = rgba.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), degrees, 1.0)
    cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
    new_w, new_h = int(height * sin + width * cos), int(height * cos + width * sin)
    matrix[0, 2] += new_w / 2 - width / 2
    matrix[1, 2] += new_h / 2 - height / 2
    return cv2.warpAffine(rgba, matrix, (new_w, new_h), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))


def fit_background(image: np.ndarray, rng: random.Random) -> np.ndarray:
    """Random crop of the background to 4:3, resized to OUT_SIZE."""
    height, width = image.shape[:2]
    target = OUT_SIZE[0] / OUT_SIZE[1]
    if width / height > target:
        new_w = int(height * target)
        x = rng.randint(0, width - new_w)
        image = image[:, x:x + new_w]
    else:
        new_h = int(width / target)
        y = rng.randint(0, height - new_h)
        image = image[y:y + new_h]
    if rng.random() < 0.5:
        image = image[:, ::-1]
    return cv2.resize(np.ascontiguousarray(image), OUT_SIZE, interpolation=cv2.INTER_AREA)


def paste(scene: np.ndarray, rgba: np.ndarray, rng: random.Random, placed: list[tuple[int, int, int, int]]):
    """Paste one object; returns its pixel box or None if it can't be placed without heavy overlap."""
    scene_h, scene_w = scene.shape[:2]
    target_w = rng.uniform(0.08, 0.45) * scene_w
    scale = target_w / rgba.shape[1]
    if rgba.shape[0] * scale > 0.7 * scene_h:
        scale = 0.7 * scene_h / rgba.shape[0]
    rgba = cv2.resize(rgba, (max(8, int(rgba.shape[1] * scale)), max(8, int(rgba.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    rgba = rotate(rgba, rng.uniform(-25, 25))
    ys, xs = np.nonzero(rgba[:, :, 3] > 40)
    if len(xs) == 0:
        return None
    rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    obj_h, obj_w = rgba.shape[:2]
    if obj_w >= scene_w or obj_h >= scene_h:
        return None
    for _ in range(20):
        x, y = rng.randint(0, scene_w - obj_w), rng.randint(0, scene_h - obj_h)
        box = (x, y, x + obj_w, y + obj_h)
        if all(overlap(box, other) < 0.2 for other in placed):
            break
    else:
        return None

    region = scene[y:y + obj_h, x:x + obj_w].astype(np.float32)
    colour = rgba[:, :, :3].astype(np.float32)
    # Match the object's brightness roughly to the spot it's placed in (webcam scenes are darker than studio shots).
    gain = np.clip((region.mean() + 40) / max(colour.mean(), 1), 0.55, 1.15)
    colour = np.clip(colour * gain, 0, 255)
    alpha = rgba[:, :, 3:4].astype(np.float32) / 255
    scene[y:y + obj_h, x:x + obj_w] = (colour * alpha + region * (1 - alpha)).astype(np.uint8)
    return box


def overlap(a, b) -> float:
    width = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    height = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return width * height / max(smaller, 1)


def webcam_look(image: np.ndarray, rng: random.Random) -> np.ndarray:
    height, width = image.shape[:2]
    if rng.random() < 0.7:  # cheap sensor: lose detail, then upscale
        factor = rng.uniform(0.35, 0.8)
        small = cv2.resize(image, (int(width * factor), int(height * factor)), interpolation=cv2.INTER_AREA)
        image = cv2.resize(small, (width, height), interpolation=cv2.INTER_LINEAR)
    if rng.random() < 0.5:
        image = cv2.GaussianBlur(image, (0, 0), rng.uniform(0.4, 1.6))
    out = image.astype(np.float32)
    out = out * rng.uniform(0.55, 1.1) + rng.uniform(-25, 15)                        # exposure
    out = (out - out.mean()) * rng.uniform(0.7, 1.05) + out.mean()                    # contrast
    out = out * np.array([rng.uniform(0.85, 1.1), rng.uniform(0.9, 1.05), rng.uniform(0.85, 1.15)])  # colour cast (BGR)
    out += np.random.default_rng(rng.randint(0, 2**31)).normal(0, rng.uniform(2, 9), out.shape)  # sensor noise
    out = np.clip(out, 0, 255).astype(np.uint8)
    ok, encoded = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, rng.randint(35, 85)])
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def build_split(source: Path, out: Path, split: str, out_split: str, count: int, rng: random.Random, class_count: int) -> dict[int, int]:
    objects: dict[int, list[np.ndarray]] = defaultdict(list)
    backgrounds: list[Path] = []
    for image_path in sorted((source / "images" / split).glob("*.jpg")):
        labels = read_labels(source / "labels" / split / f"{image_path.stem}.txt")
        if not labels:
            backgrounds.append(image_path)
            continue
        image = cv2.imread(str(image_path))
        if image is None:
            continue
        for cls, x, y, w, h in labels:
            if w * h > 0.97:  # the "box" is the whole photo, nothing to cut out
                continue
            cut = cut_object(image, (x, y, w, h))
            if cut is not None:
                objects[cls].append(cut)
    classes = sorted(objects)
    if not classes or not backgrounds:
        raise SystemExit(f"{split}: no objects or backgrounds to build scenes from")

    image_dir, label_dir = out / "images" / out_split, out / "labels" / out_split
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)
    instances: dict[int, int] = defaultdict(int)
    for index in range(count):
        scene = fit_background(cv2.imread(str(rng.choice(backgrounds))), rng)
        lines, placed = [], []
        for _ in range(rng.choices([1, 2, 3], weights=[0.6, 0.3, 0.1])[0]):
            cls = rng.choice(classes)  # class-balanced: weak classes get as many scenes as strong ones
            box = paste(scene, rng.choice(objects[cls]), rng, placed)
            if box is None:
                continue
            placed.append(box)
            x1, y1, x2, y2 = box
            lines.append(f"{cls} {(x1 + x2) / 2 / OUT_SIZE[0]:.6f} {(y1 + y2) / 2 / OUT_SIZE[1]:.6f} {(x2 - x1) / OUT_SIZE[0]:.6f} {(y2 - y1) / OUT_SIZE[1]:.6f}")
            instances[cls] += 1
        name = f"_scene_{split}_{index:05d}"
        cv2.imwrite(str(image_dir / f"{name}.jpg"), webcam_look(scene, rng), [cv2.IMWRITE_JPEG_QUALITY, 92])
        (label_dir / f"{name}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    print(f"{out_split}: {count} scenes from {sum(len(v) for v in objects.values())} objects and {len(backgrounds)} backgrounds")
    return instances


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--train", type=int, default=2600)
    parser.add_argument("--val", type=int, default=300)
    parser.add_argument("--test", type=int, default=300)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if args.out.exists():
        raise SystemExit(f"{args.out} already exists; choose a new name so earlier datasets stay unchanged")
    config = yaml.safe_load((args.source / "data.yaml").read_text(encoding="utf-8"))
    names = config["names"] if isinstance(config["names"], list) else [config["names"][i] for i in sorted(config["names"])]

    for kind in ("images", "labels"):
        shutil.copytree(args.source / kind, args.out / kind)
    rng = random.Random(args.seed)
    report = {}
    report["train"] = build_split(args.source, args.out, "train", "train", args.train, rng, len(names))
    report["val"] = build_split(args.source, args.out, "val", "val", args.val, rng, len(names))
    report["scene_test"] = build_split(args.source, args.out, "test", "scene_test", args.test, rng, len(names))

    data = {"path": str(args.out.resolve()).replace("\\", "/"), "train": "images/train", "val": "images/val",
            "test": "images/test", "scene_test": "images/scene_test", "nc": len(names), "names": names}
    (args.out / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")

    lines = ["# Synthetic webcam scenes", "", f"Source: `{args.source}`", "",
             "| Class | train scenes | val scenes | scene_test |", "|---|---|---|---|"]
    for cls, name in enumerate(names):
        lines.append(f"| {name} | {report['train'].get(cls, 0)} | {report['val'].get(cls, 0)} | {report['scene_test'].get(cls, 0)} |")
    (args.out / "scenes_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
