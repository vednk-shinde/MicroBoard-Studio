"""Assemble the training dataset from the auto-labelled images, the hand-labelled board photos and
hard negatives, then split it into train/val/test without leakage.

Sources
- <labeled>/images + labels (autolabel.py output) with classes.json
- ml/dataset/yolo (hand-labelled Kaggle "Microcontroller Detection" photos): every board becomes
  Microcontroller_Board, keeping the original human-drawn boxes
- hard negatives: images autolabel.py rejected because a person, poster, console, furniture, etc.
  dominated them AND the component scored below NEGATIVE_MAX_COMPONENT. They get empty label files,
  which teaches the detector that these things are not components.

Near-duplicates (perceptual hash distance <= 4) are always placed in the same split.

Usage:
    python ml/component_detection/build_dataset.py <labeled_dir> <source_dir> <out_dir>
"""

from __future__ import annotations

import csv
import json
import random
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

MIN_IMAGES_PER_CLASS = 25  # fewer good images than this can't train a class reliably; it is dropped and reported
SPLITS = {"train": 0.70, "val": 0.15, "test": 0.15}
SEED = 42
# Diagrams, text and charts are not used: they often contain small pictures of components.
NEGATIVE_KINDS = ("a person", "a human face", "a hand", "a video game console", "furniture", "a movie poster", "a cartoon drawing",
                  "a room lamp", "a television", "clothing", "a blanket", "a building", "a car")
NEGATIVE_MIN_PROB = 0.6
BOARD_DATASET = Path("ml/dataset/yolo")


def dhash(path: Path) -> int:
    with Image.open(path) as image:
        small = image.convert("L").resize((9, 8))
    pixels = list(small.getdata())
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1])
    return bits


def group_near_duplicates(paths: list[Path]) -> list[list[Path]]:
    hashes = [(path, dhash(path)) for path in paths]
    parent = list(range(len(hashes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            if bin(hashes[i][1] ^ hashes[j][1]).count("1") <= 4:
                parent[find(i)] = find(j)
    groups: dict[int, list[Path]] = defaultdict(list)
    for index, (path, _) in enumerate(hashes):
        groups[find(index)].append(path)
    return list(groups.values())


def split_groups(groups: list[list[Path]], rng: random.Random) -> dict[str, list[Path]]:
    rng.shuffle(groups)
    total = sum(len(group) for group in groups)
    assigned = {split: [] for split in SPLITS}
    for group in sorted(groups, key=len, reverse=True):
        # Put each group where the split is furthest below its target share.
        split = min(SPLITS, key=lambda name: len(assigned[name]) / max(total * SPLITS[name], 1e-9))
        assigned[split].extend(group)
    return assigned


def main() -> int:
    labeled, source, out = (Path(arg) for arg in sys.argv[1:4])
    class_names: list[str] = json.loads((labeled / "classes.json").read_text(encoding="utf-8"))
    board_id = class_names.index("Microcontroller_Board")
    rng = random.Random(SEED)
    if out.exists():
        shutil.rmtree(out)
    for split in SPLITS:
        (out / "images" / split).mkdir(parents=True)
        (out / "labels" / split).mkdir(parents=True)

    # item = (image path, label text, group key for stratification)
    items: dict[Path, tuple[str, str]] = {}
    for label_path in sorted((labeled / "labels").glob("*.txt")):
        image_path = labeled / "images" / f"{label_path.stem}.jpg"
        first_class = int(label_path.read_text(encoding="utf-8").split()[0])
        items[image_path] = (label_path.read_text(encoding="utf-8"), class_names[first_class])

    board_count = 0
    for image_path in sorted(BOARD_DATASET.glob("images/*/*")):
        label_path = BOARD_DATASET / "labels" / image_path.parent.name / f"{image_path.stem}.txt"
        if not label_path.exists():
            continue
        lines = [line.split() for line in label_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        text = "".join(f"{board_id} {' '.join(fields[1:])}\n" for fields in lines)
        items[image_path] = (text, "Microcontroller_Board")
        board_count += 1

    negatives = []
    with (labeled / "autolabel_log.csv").open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            # Only images CLIP is confident show something else (a person, a console, a poster...), never ones
            # that might still contain the component, which would teach the detector to ignore real parts.
            if (row["decision"] == "rejected" and row["reason"].startswith("image looks like") and row["top_distractor"] in NEGATIVE_KINDS
                    and float(row["top_distractor_prob"]) >= NEGATIVE_MIN_PROB and float(row["clip_component_prob"]) < 0.1):
                negatives.append(source / "images" / row["folder"] / row["file"])

    for path in negatives:
        items[path] = ("", "_background")

    # Drop classes with too few images and renumber the rest contiguously.
    per_class = Counter(key for _, key in items.values() if key != "_background")
    dropped = {name: per_class.get(name, 0) for name in class_names if per_class.get(name, 0) < MIN_IMAGES_PER_CLASS}
    kept_names = [name for name in class_names if name not in dropped]
    remap = {class_names.index(name): index for index, name in enumerate(kept_names)}
    filtered = {}
    for path, (text, key) in items.items():
        if key in dropped:
            continue
        lines = [line.split() for line in text.splitlines() if line.strip()]
        lines = [[str(remap[int(fields[0])]), *fields[1:]] for fields in lines if int(fields[0]) in remap]
        filtered[path] = ("".join(" ".join(fields) + "\n" for fields in lines), key)
    items = filtered
    class_names = kept_names

    # Stratified, near-duplicate-aware split.
    by_class: dict[str, list[Path]] = defaultdict(list)
    for path, (_, key) in items.items():
        by_class[key].append(path)
    placement: dict[Path, str] = {}
    for key, paths in sorted(by_class.items()):
        for split, assigned in split_groups(group_near_duplicates(paths), rng).items():
            for path in assigned:
                placement[path] = split

    counts = defaultdict(Counter)
    for index, (path, (text, key)) in enumerate(sorted(items.items(), key=lambda pair: str(pair[0]))):
        split = placement[path]
        stem = f"{key.lower()}_{index:05d}"
        with Image.open(path) as image:
            image.convert("RGB").save(out / "images" / split / f"{stem}.jpg", quality=92)
        (out / "labels" / split / f"{stem}.txt").write_text(text, encoding="utf-8")
        counts[split][key] += 1

    # Absolute path: Ultralytics resolves a relative "path" from the working directory, not from the yaml file.
    yaml_lines = [f"path: {out.resolve().as_posix()}", "train: images/train", "val: images/val", "test: images/test", "names:"] + [f"  {i}: {name}" for i, name in enumerate(class_names)]
    (out / "data.yaml").write_text("\n".join(yaml_lines) + "\n", encoding="utf-8")
    keys = sorted({key for split in counts.values() for key in split})
    report = ["# Dataset build", "", f"- Hand-labelled board photos added: {board_count}", f"- Hard negatives (empty labels): {len(negatives)}",
              f"- Classes dropped (fewer than {MIN_IMAGES_PER_CLASS} good images): " + (", ".join(f"{name} ({count})" for name, count in dropped.items()) or "none"),
              f"- Classes trained: {len(class_names)}", "",
              "| Class | " + " | ".join(SPLITS) + " |", "|---|" + "---|" * len(SPLITS)]
    report += [f"| {key} | " + " | ".join(str(counts[split][key]) for split in SPLITS) + " |" for key in keys]
    report += ["| **Total** | " + " | ".join(str(sum(counts[split].values())) for split in SPLITS) + " |"]
    (out / "build_report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
