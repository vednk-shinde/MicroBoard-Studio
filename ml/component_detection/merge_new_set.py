"""Merge the lenient-labelled component_dataset into the existing detection dataset.

1. Drops images that were reviewed by eye on the review_*.jpg sheets and found to be wrong (3D-printed parts,
   chip/die close-ups, circuit diagrams, boxes on the wrong object). The drop list is kept below so the
   cleaning is reproducible; nothing is deleted from the source folders.
2. Classes with fewer than MIN_IMAGES images left are not trained (reported, not silently dropped).
3. Adds the new images to the existing dataset's train/val splits (classes with >= 10 images also get a test image
   share), plus the new background photos as hard negatives. Class IDs are remapped by name.

Usage:
    python ml/component_detection/merge_new_set.py <new_labeled_dir> <old_dataset_dir> <out_dataset_dir>
"""

from __future__ import annotations

import argparse
import csv
import random
import shutil
from collections import defaultdict
from pathlib import Path

import yaml

MIN_IMAGES = 4

# Global index into the kept rows of label_log.csv (the order of the review_*.jpg sheets, 36 per sheet).
DROP = {5, *range(72 + 17, 72 + 28),
        126, 132, 134, 135, 138, 140, 141, 143,
        145, 146, 152, 163, 164, 167, 169, 171, 174, 175, 176, 177,
        *(180 + p for p in (0, 1, 2, 3, 4, 5, 7, 8, 9, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 30, 31, 32)),
        *(216 + p for p in (0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17, 18, 27, 28, 29, 30, 31, 32, 33, 34))}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("new", type=Path)
    parser.add_argument("old", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--background", type=Path, default=None, help="folder of no-component photos (hard negatives)")
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit(f"{args.out} exists; choose a new name")

    new_names = __import__("json").loads((args.new / "classes.json").read_text(encoding="utf-8"))
    old_config = yaml.safe_load((args.old / "data.yaml").read_text(encoding="utf-8"))
    old_names = old_config["names"] if isinstance(old_config["names"], list) else [old_config["names"][i] for i in sorted(old_config["names"])]

    kept = [row for row in csv.DictReader((args.new / "label_log.csv").open(encoding="utf-8")) if row["decision"] == "kept"]
    by_class: dict[str, list[str]] = defaultdict(list)
    dropped = 0
    for index, row in enumerate(kept):
        if index in DROP:
            dropped += 1
            continue
        by_class[row["class"]].append(f"{row['class']}|{row['file']}")
    print(f"reviewed-and-dropped {dropped} of {len(kept)} images")

    # Final class list: all old classes, then every new class that still has enough images.
    names = list(old_names)
    skipped = {}
    for cls in sorted(by_class):
        if cls in names:
            continue
        if len(by_class[cls]) >= MIN_IMAGES:
            names.append(cls)
        else:
            skipped[cls] = len(by_class[cls])

    for kind in ("images", "labels"):
        shutil.copytree(args.old / kind, args.out / kind)

    rng = random.Random(42)
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for cls, items in by_class.items():
        if cls not in names:
            continue
        items = sorted(items)
        rng.shuffle(items)
        n = len(items)
        n_test = round(n * 0.15) if n >= 10 else 0
        n_val = max(1, round(n * 0.15))
        plan = ["test"] * n_test + ["val"] * n_val + ["train"] * (n - n_test - n_val)
        for item, split in zip(items, plan):
            _, file = item.split("|")
            # The labelled copy is named <folder>_<source stem>.jpg (see label_small_set.py).
            for image in (args.new / "images").glob(f"*_{Path(file).stem}.jpg"):
                label = args.new / "labels" / f"{image.stem}.txt"
                rows = [" ".join([str(names.index(new_names[int(parts[0])])), *parts[1:]])
                        for parts in (line.split() for line in label.read_text(encoding="utf-8").splitlines())]
                shutil.copyfile(image, args.out / "images" / split / f"new_{image.name}")
                (args.out / "labels" / split / f"new_{image.stem}.txt").write_text("\n".join(rows) + "\n", encoding="utf-8")
                counts[cls][split] += 1

    background = sorted(args.background.glob("*.jpg")) if args.background else []
    for index, image in enumerate(background):
        split = "val" if index % 5 == 0 else "train"
        shutil.copyfile(image, args.out / "images" / split / f"newbg_{image.name}")
        (args.out / "labels" / split / f"newbg_{image.stem}.txt").write_text("", encoding="utf-8")

    data = {"path": str(args.out.resolve()).replace("\\", "/"), "train": "images/train", "val": "images/val", "test": "images/test",
            "nc": len(names), "names": names}
    (args.out / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")

    lines = ["# Merge report", "", f"- Reviewed by eye and dropped (3D prints, chip close-ups, diagrams, wrong boxes): {dropped}",
             f"- Classes not trained (fewer than {MIN_IMAGES} usable images): {skipped or 'none'}",
             f"- New background photos added: {len(background)}", "", "| New class | train | val | test |", "|---|---|---|---|"]
    for cls in names[len(old_names):]:
        lines.append(f"| {cls} | {counts[cls]['train']} | {counts[cls]['val']} | {counts[cls]['test']} |")
    lines += ["", "Existing classes that received extra images: " + ", ".join(f"{c} (+{sum(v.values())})" for c, v in counts.items() if c in old_names)]
    (args.out / "merge_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
