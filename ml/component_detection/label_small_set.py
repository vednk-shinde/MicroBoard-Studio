"""Lenient labelling for a small, already-curated folder-per-class set (e.g. component_dataset).

autolabel.py is strict (CLIP photo checks, crop checks) and is right for a noisy 3,000-image scrape, but on a
set with 5-15 images per class it throws most of them away. Here every image is kept unless it is clearly not
a photo of one subject. The box comes from, in order:
  1. YOLO-World prompted with the class description (confidence >= 0.08, box covers 3-97% of the image),
  2. the non-background pixels of a plain-background product photo,
  3. the whole photo (minus a 2% margin) when CLIP says the image is mostly that component (>= 0.5).
Every decision and its box source is written to label_log.csv, and review sheets with the boxes drawn are
saved per class group so the boxes can be checked by eye.

Usage:
    python ml/component_detection/label_small_set.py <source_dir with images/<folder>/> <out_dir>
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import clip
import torch
from PIL import Image, ImageDraw
from ultralytics import YOLOWorld

sys.path.insert(0, str(Path(__file__).parent))
from autolabel import CLASSES, DISTRACTORS, area, plain_background_box  # noqa: E402

WORLD_MIN_CONF = 0.08
MIN_AREA, MAX_AREA = 0.03, 0.97
WHOLE_PHOTO_MIN_CLIP = 0.5
REJECT_DISTRACTOR = 0.7   # CLIP is this sure the image is a person/poster/etc. and not the part


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--model", default="ml/weights/yolov8x-worldv2.pt")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    world = YOLOWorld(args.model)
    clip_model, preprocess = clip.load("ViT-B/32", device=device, download_root=str(Path(args.model).parent / "clip"))
    (args.out / "images").mkdir(parents=True, exist_ok=True)
    (args.out / "labels").mkdir(parents=True, exist_ok=True)

    def text(texts):
        with torch.no_grad():
            features = clip_model.encode_text(clip.tokenize(texts).to(device)).float()
        return features / features.norm(dim=-1, keepdim=True)

    distractors = text(DISTRACTORS)
    rows, review = [], []
    names = sorted({final for _, final in CLASSES.values()})
    for folder, (prompt, final) in CLASSES.items():
        files = sorted((args.source / "images" / folder).glob("*.jpg"))
        if not files:
            continue
        component = text([f"a photo of a {prompt}"])
        world.set_classes([prompt])
        kept = 0
        for path in files:
            image = Image.open(path).convert("RGB")
            width, height = image.size
            with torch.no_grad():
                features = clip_model.encode_image(preprocess(image).unsqueeze(0).to(device)).float()
            features = features / features.norm(dim=-1, keepdim=True)
            probs = (100.0 * features @ torch.cat([component, distractors]).T).softmax(dim=-1)[0].tolist()
            part_prob, top = probs[0], max(range(len(DISTRACTORS)), key=lambda i: probs[i + 1])
            row = {"class": final, "file": path.name, "clip_part": f"{part_prob:.2f}", "box_source": "", "decision": "rejected", "reason": ""}
            if probs[top + 1] >= REJECT_DISTRACTOR and part_prob < 0.2:
                row["reason"] = f"looks like {DISTRACTORS[top]} ({probs[top + 1]:.2f})"
                rows.append(row)
                continue

            result = world.predict(str(path), conf=WORLD_MIN_CONF, iou=0.5, device=0 if device == "cuda" else "cpu", verbose=False)[0]
            boxes = [(b, c) for b, c in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist()) if MIN_AREA <= area(b, width, height) <= MAX_AREA]
            source = "yolo-world"
            if not boxes:
                fallback = plain_background_box(image)
                boxes, source = ([(fallback, 0.0)], "plain-background") if fallback else ([], "")
            if not boxes and part_prob >= WHOLE_PHOTO_MIN_CLIP:
                margin_x, margin_y = width * 0.02, height * 0.02
                boxes, source = [([margin_x, margin_y, width - margin_x, height - margin_y], 0.0)], "whole-photo"
            if not boxes:
                row["reason"] = f"no box found (clip {part_prob:.2f})"
                rows.append(row)
                continue
            # Keep the single most confident box: these are one-subject photos, extra boxes are mostly noise.
            box = max(boxes, key=lambda item: item[1])[0]
            stem = f"{folder}_{path.stem}"
            image.save(args.out / "images" / f"{stem}.jpg", quality=92)
            x1, y1, x2, y2 = box
            (args.out / "labels" / f"{stem}.txt").write_text(
                f"{names.index(final)} {(x1 + x2) / 2 / width:.6f} {(y1 + y2) / 2 / height:.6f} {(x2 - x1) / width:.6f} {(y2 - y1) / height:.6f}\n", encoding="utf-8")
            row.update(decision="kept", box_source=source)
            rows.append(row)
            review.append((final, path, box, source))
            kept += 1
        print(f"{final:22s} kept {kept:3d} / {len(files)}", flush=True)

    with (args.out / "label_log.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["class", "file", "clip_part", "box_source", "decision", "reason"])
        writer.writeheader()
        writer.writerows(rows)
    (args.out / "classes.json").write_text(__import__("json").dumps(names, indent=1), encoding="utf-8")

    tile, per_row = 220, 6
    for group, start in enumerate(range(0, len(review), 36)):
        chunk = review[start:start + 36]
        sheet = Image.new("RGB", (per_row * tile, ((len(chunk) + per_row - 1) // per_row) * (tile + 14)), "white")
        canvas = ImageDraw.Draw(sheet)
        for index, (final, path, box, source) in enumerate(chunk):
            image = Image.open(path).convert("RGB")
            ImageDraw.Draw(image).rectangle(box, outline=(255, 0, 0), width=max(3, image.width // 120))
            image.thumbnail((tile - 4, tile - 4))
            x, y = (index % per_row) * tile, (index // per_row) * (tile + 14)
            sheet.paste(image, (x + 2, y + 14))
            canvas.text((x + 2, y), f"{final} [{source[:5]}]", fill="black")
        sheet.save(args.out / f"review_{group}.jpg", quality=82)
    print(f"kept {sum(r['decision'] == 'kept' for r in rows)} / {len(rows)}; box sources:",
          {s: sum(r['box_source'] == s for r in rows) for s in ('yolo-world', 'plain-background', 'whole-photo')})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
