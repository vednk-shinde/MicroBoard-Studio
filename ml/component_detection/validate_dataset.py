"""Validate a YOLO detection dataset before training and write a report.

Usage:
    python ml/component_detection/validate_dataset.py <dataset_dir> [--report-dir DIR] [--min-instances N]

Checks: data.yaml and class list consistency (classes.txt / components_manifest.csv when present),
missing or orphaned images/labels, corrupted images, malformed YOLO lines, class IDs out of range,
boxes outside the image, very small boxes, empty label files (background images), duplicate images
within and across splits (train/val/test leakage), class imbalance and classes with too few examples,
plus a review of class names that look like the same physical part.

Nothing is modified or deleted: problems are listed in the report so they can be fixed deliberately.
Exit code: 0 = ready to train, 1 = blocking problems found.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from PIL import Image, UnidentifiedImageError

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLITS = ("train", "val", "test")
TINY_BOX_PIXELS = 8           # boxes narrower/shorter than this are hard to learn at 640 px
TINY_BOX_AREA = 0.0004        # 0.04 % of the image
BOUNDS_TOLERANCE = 0.002

# Class names in the MicroBoard taxonomy that describe the same physical module, or overlap so
# that one object could correctly carry either label. A detector can't learn two labels for one look.
KNOWN_OVERLAPS = [
    ("GY521", "MPU6050", "GY-521 is the common MPU6050 breakout board"),
    ("SSD1306_OLED", "OLED_0.96", "the usual 0.96\" OLED module is an SSD1306 128x64"),
    ("SSD1306_OLED", "OLED_128x64", "same SSD1306 128x64 module"),
    ("OLED_0.96", "OLED_128x64", "same 0.96\" 128x64 module"),
    ("RFID_RFID522", "RC522", "same MFRC522 RFID reader"),
    ("PN532_NFC", "PN532", "same PN532 NFC module"),
    ("Gas_MQ2", "MQ2_Gas_Sensor", "same MQ-2 module"),
    ("NEO6M_GPS", "GPS_NEO6M", "same NEO-6M GPS module"),
    ("PIR_HC_SR501", "HC_SR501_PIR", "same HC-SR501 PIR module"),
    ("PIR_Sensor", "HC_SR501_PIR", "generic PIR label overlaps the specific HC-SR501"),
    ("L298N_Module", "L298N", "an L298N is normally sold as this module"),
    ("TB6612FNG_Module", "TB6612FNG", "same breakout"),
    ("MAX7219_8x8", "MAX7219_Module", "MAX7219 module is usually the 8x8 matrix board"),
    ("MAX7219_8x8", "LED_Matrix_8x8", "an 8x8 matrix is usually driven by a MAX7219 board"),
    ("Rotary_Encoder_KY040", "Rotary_Encoder", "KY-040 is the common rotary encoder module"),
    ("TTP223_Touch", "Touch_Sensor_TTP223", "same TTP223 touch module"),
    ("Logic_Level_Converter", "Logic_Level_Shifter", "same part, different name"),
    ("USB_TTL_CP2102", "USB_TTL", "generic label overlaps the specific adapters"),
    ("USB_TTL_CH340", "USB_TTL", "generic label overlaps the specific adapters"),
    ("Relay_5V", "Relay_Module", "a 5 V relay module is the common relay module"),
    ("Screw_Terminal", "Terminal_Block", "same part"),
    ("Rain_Drop_Module", "Rain_Sensor", "same rain sensor board"),
    ("KY038_Sound_Module", "Sound_Sensor", "KY-038 is the common sound sensor module"),
    ("Soil_Moisture_Capacitive", "Soil_Moisture_Sensor", "generic label overlaps the specific type"),
    ("NodeMCU_ESP8266", "ESP8266_Module", "overlap unless ESP8266_Module means only the ESP-01"),
    ("Gamepad_Joystick", "Joystick_Module", "overlap unless they are visually different products"),
    ("7Segment_4Digit", "Seven_Segment", "overlap unless Seven_Segment means single digit only"),
    ("TM1637_4Digit", "7Segment_4Digit", "TM1637 boards are 4-digit 7-segment displays"),
    ("Jumper_Wires", "Dupont_Male_Male", "generic label overlaps the specific Dupont types"),
    ("Buzzer", "Active_Buzzer", "generic label overlaps; active/passive buzzers often look identical"),
    ("Buzzer", "Passive_Buzzer", "generic label overlaps; active/passive buzzers often look identical"),
    ("Capacitor", "Electrolytic_Capacitor", "generic label overlaps the specific types"),
    ("Capacitor", "Ceramic_Capacitor", "generic label overlaps the specific types"),
    ("LED_5mm", "LED_Red", "size and colour are different properties: a red 5 mm LED fits both labels"),
    ("LED_3mm", "LED_Red", "size and colour are different properties of the same object"),
    ("NeoPixel_Strip", "LED_Strip", "overlap unless LED_Strip means non-addressable only"),
    ("NeoPixel_Ring", "WS2812B", "NeoPixel rings are WS2812B LEDs"),
    ("Stepper_A4988", "DRV8825", "visually near-identical driver carriers (only the chip marking differs)"),
    ("LDR_Module", "LDR", "module vs bare part: OK if annotated consistently"),
    ("TCRT5000_Module", "TCRT5000_IR_Sensor", "overlap unless one means the bare sensor"),
    ("RTC_DS1307", "DS3231_RTC", "different chips, but modules can look very similar"),
]

# Pairs that are genuinely different parts but hard or impossible to tell apart from a webcam image.
HARD_TO_SEPARATE = [
    ("HC_SR04", "HC_SR04_Mini", "same transducer layout; size is the main cue"),
    ("HC_SR04", "US_100", "very similar dual-transducer boards"),
    ("DHT11", "DHT22", "blue vs white housing; reliable only if colour is visible"),
    ("MPU6050", "MPU9250", "breakouts look similar; chip marking is too small for a webcam"),
    ("MPU6050", "MPU6500", "same breakout style; chip marking is too small for a webcam"),
    ("BMP280", "BME280", "identical breakouts; only the chip marking differs"),
    ("BMP180", "BMP280", "small purple breakouts with similar layouts"),
    ("HC05_Bluetooth", "HC06_Bluetooth", "same module family; often only pin count differs"),
    ("Active_Buzzer", "Passive_Buzzer", "often identical apart from a sealed bottom"),
    ("L293D", "L298N", "different packages; fine as bare chip vs module, hard if both are shields"),
    ("SG90_Servo", "MG996R_Servo", "different sizes; fine if scale is visible"),
    ("Arduino_Uno", "Arduino_Leonardo", "same form factor; USB connector and chip are the cues"),
    ("Resistor", "1N4007_Diode", "small axial parts; needs close-up images"),
]


@dataclass
class Report:
    blocking: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    invalid_samples: list[dict] = field(default_factory=list)


def load_names(data_yaml: Path) -> tuple[list[str], dict]:
    config = yaml.safe_load(data_yaml.read_text(encoding="utf-8")) or {}
    names = config.get("names", [])
    if isinstance(names, dict):
        ordered = [names[key] for key in sorted(names, key=int)]
        if sorted(int(key) for key in names) != list(range(len(names))):
            raise ValueError("data.yaml class IDs are not a contiguous 0..N-1 range")
        return [str(name) for name in ordered], config
    return [str(name) for name in names], config


def normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def file_hash(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate(dataset: Path, min_instances: int) -> tuple[Report, dict]:
    report = Report()

    def rel(path: Path) -> str:
        """Paths in the report are relative to the dataset folder."""
        try:
            return str(Path(path).relative_to(dataset))
        except ValueError:
            return str(path)

    data_yaml = dataset / "data.yaml"
    if not data_yaml.is_file():
        report.blocking.append("Missing data.yaml")
        return report, {}

    names, config = load_names(data_yaml)
    stats: dict = {"classes": len(names), "names": names}

    # ---- class list consistency
    if "nc" in config and int(config["nc"]) != len(names):
        report.blocking.append(f"data.yaml nc={config['nc']} but {len(names)} names are listed")
    duplicates = [name for name, count in Counter(names).items() if count > 1]
    if duplicates:
        report.blocking.append(f"Duplicate class names in data.yaml: {duplicates}")
    normalized = defaultdict(list)
    for name in names:
        normalized[normalize(name)].append(name)
    for group in normalized.values():
        if len(group) > 1:
            report.warnings.append(f"Class names that differ only in punctuation/case: {group}")

    classes_txt = dataset / "classes.txt"
    if classes_txt.is_file():
        listed = [line.strip() for line in classes_txt.read_text(encoding="utf-8").splitlines() if line.strip()]
        if listed != names:
            report.blocking.append(f"classes.txt ({len(listed)} classes) does not match data.yaml ({len(names)} classes) in content/order")
    manifest = dataset / "components_manifest.csv"
    targets: dict[str, int] = {}
    if manifest.is_file():
        with manifest.open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        manifest_names = [row.get("yolo_class_name", "") for row in rows]
        if manifest_names != names:
            report.blocking.append("components_manifest.csv class order does not match data.yaml")
        for row in rows:
            name = row.get("yolo_class_name", "")
            if name in names and row.get("class_id", "").strip().isdigit() and int(row["class_id"]) != names.index(name):
                report.blocking.append(f"Manifest class_id {row['class_id']} for {name} does not match data.yaml ID {names.index(name)}")
            try:
                targets[row["yolo_class_name"]] = int(row.get("target_images_total") or 0)
            except ValueError:
                pass
        stats["target_images_total"] = sum(targets.values())
    readme = dataset / "README.md"
    if readme.is_file():
        claimed = re.search(r"Classes:\s*(\d+)", readme.read_text(encoding="utf-8"))
        if claimed and int(claimed.group(1)) != len(names):
            report.warnings.append(f"README.md says {claimed.group(1)} classes but data.yaml lists {len(names)}")

    # ---- taxonomy review
    present = set(names)
    stats["overlapping_classes"] = [
        {"a": a, "b": b, "why": why} for a, b, why in KNOWN_OVERLAPS if a in present and b in present
    ]
    stats["hard_to_separate"] = [
        {"a": a, "b": b, "why": why} for a, b, why in HARD_TO_SEPARATE if a in present and b in present
    ]
    if stats["overlapping_classes"]:
        report.warnings.append(
            f"{len(stats['overlapping_classes'])} class pairs look like the same physical part or overlap; "
            "merge them (or define them precisely) before annotating, or the detector will be trained on contradictory labels"
        )

    # ---- images and labels
    split_paths = {}
    for split in SPLITS:
        value = config.get(split)
        if value is None:
            if split == "test":
                report.warnings.append("data.yaml has no test split: a held-out test set is needed for honest evaluation")
            else:
                report.blocking.append(f"data.yaml has no '{split}' entry")
            continue
        root = Path(config.get("path") or ".")
        root = (dataset / root).resolve() if not root.is_absolute() else root
        image_dir = (root / value).resolve()
        split_paths[split] = image_dir

    hashes: dict[str, list[str]] = defaultdict(list)
    per_class_instances: Counter = Counter()
    per_class_images: dict[str, set] = defaultdict(set)
    split_counts: dict[str, dict] = {}
    objects_per_image: list[int] = []
    total_images = 0

    for split, image_dir in split_paths.items():
        # YOLO convention: .../images/<split> pairs with .../labels/<split> (last "images" component).
        parts = list(image_dir.parts)
        if "images" in parts:
            parts[len(parts) - 1 - parts[::-1].index("images")] = "labels"
        label_dir = Path(*parts)
        if not image_dir.is_dir():
            report.blocking.append(f"{split}: image directory does not exist: {rel(image_dir)}")
            split_counts[split] = {"images": 0, "boxes": 0, "background": 0}
            continue
        images = sorted(path for path in image_dir.rglob("*") if path.suffix.lower() in IMAGE_EXTENSIONS)
        labels = {path.relative_to(label_dir).with_suffix(""): path for path in label_dir.rglob("*.txt")} if label_dir.is_dir() else {}
        image_keys = {path.relative_to(image_dir).with_suffix(""): path for path in images}
        counts = {"images": len(images), "boxes": 0, "background": 0}
        total_images += len(images)
        if not images:
            report.blocking.append(f"{split}: no images in {rel(image_dir)}")

        for key in sorted(labels.keys() - image_keys.keys(), key=str):
            report.invalid_samples.append({"split": split, "file": rel(labels[key]), "problem": "label file has no matching image"})
        for key, image_path in image_keys.items():
            problem = None
            try:
                with Image.open(image_path) as image:
                    image.verify()
                with Image.open(image_path) as image:
                    width, height = image.size
            except (UnidentifiedImageError, OSError) as error:
                problem = f"corrupted or unreadable image ({error.__class__.__name__})"
                width = height = 0
            if problem:
                report.invalid_samples.append({"split": split, "file": rel(image_path), "problem": problem})
                continue
            hashes[file_hash(image_path)].append(f"{split}/{image_path.name}")

            label_path = labels.get(key)
            if label_path is None:
                report.invalid_samples.append({"split": split, "file": rel(image_path), "problem": "missing label file (treated as background by Ultralytics; add an empty .txt if intended)"})
                continue
            lines = [line for line in label_path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.lstrip().startswith("#")]
            if not lines:
                counts["background"] += 1
                objects_per_image.append(0)
                continue
            objects = 0
            for number, line in enumerate(lines, start=1):
                fields = line.split()
                where = f"{rel(label_path)}:{number}"
                if len(fields) != 5:
                    report.invalid_samples.append({"split": split, "file": where, "problem": f"expected 5 values, found {len(fields)} (segmentation/OBB labels are not plain boxes)"})
                    continue
                try:
                    class_id = int(fields[0])
                    x, y, w, h = (float(value) for value in fields[1:])
                except ValueError:
                    report.invalid_samples.append({"split": split, "file": where, "problem": "non-numeric values"})
                    continue
                if not 0 <= class_id < len(names):
                    report.invalid_samples.append({"split": split, "file": where, "problem": f"class id {class_id} outside 0..{len(names) - 1}"})
                    continue
                if w <= 0 or h <= 0:
                    report.invalid_samples.append({"split": split, "file": where, "problem": "zero or negative box size"})
                    continue
                if x - w / 2 < -BOUNDS_TOLERANCE or y - h / 2 < -BOUNDS_TOLERANCE or x + w / 2 > 1 + BOUNDS_TOLERANCE or y + h / 2 > 1 + BOUNDS_TOLERANCE:
                    report.invalid_samples.append({"split": split, "file": where, "problem": "box extends outside the image (coordinates must be normalised 0..1)"})
                    continue
                if w * width < TINY_BOX_PIXELS or h * height < TINY_BOX_PIXELS or w * h < TINY_BOX_AREA:
                    report.warnings.append(f"{where}: very small box ({w * width:.0f}x{h * height:.0f} px) for {names[class_id]}")
                objects += 1
                counts["boxes"] += 1
                per_class_instances[names[class_id]] += 1
                per_class_images[names[class_id]].add(f"{split}/{image_path.name}")
            objects_per_image.append(objects)
        split_counts[split] = counts

    # ---- duplicates and leakage
    for digest, files in hashes.items():
        if len(files) > 1:
            splits_involved = {file.split("/")[0] for file in files}
            kind = "LEAKAGE across splits" if len(splits_involved) > 1 else "duplicate within split"
            entry = f"{kind}: {', '.join(files)}"
            (report.blocking if len(splits_involved) > 1 else report.warnings).append(entry)

    # ---- class coverage
    labelled = [count for count in per_class_instances.values() if count]
    missing_classes = [name for name in names if per_class_instances[name] == 0]
    too_few = [f"{name} ({per_class_instances[name]})" for name in names if 0 < per_class_instances[name] < min_instances]
    if total_images and missing_classes:
        report.blocking.append(f"{len(missing_classes)} of {len(names)} classes have no annotations at all")
    if too_few:
        report.warnings.append(f"{len(too_few)} classes have fewer than {min_instances} annotated instances: {', '.join(too_few[:20])}{' …' if len(too_few) > 20 else ''}")

    stats.update({
        "total_images": total_images,
        "splits": split_counts,
        "total_boxes": sum(per_class_instances.values()),
        "instances_per_class": {name: per_class_instances[name] for name in names},
        "images_per_class": {name: len(per_class_images[name]) for name in names},
        "classes_with_annotations": len(labelled),
        "classes_without_annotations": len(missing_classes),
        "objects_per_image": {
            "min": min(objects_per_image) if objects_per_image else 0,
            "max": max(objects_per_image) if objects_per_image else 0,
            "mean": round(statistics.mean(objects_per_image), 2) if objects_per_image else 0,
        },
        "imbalance_ratio_max_to_min": round(max(labelled) / min(labelled), 1) if labelled else None,
    })
    if total_images == 0:
        report.blocking.append("The dataset contains no images, so there is nothing to train on")
    return report, stats


def write_report(dataset: Path, report: Report, stats: dict, report_dir: Path, min_instances: int) -> Path:
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "dataset_report.json").write_text(
        json.dumps({"dataset": dataset.name, "ready": not report.blocking, "blocking": report.blocking,
                    "warnings": report.warnings, "invalid_samples": report.invalid_samples, "stats": stats}, indent=2),
        encoding="utf-8",
    )
    lines = [
        f"# Dataset report: `{dataset.name}`",
        "",
        f"**Ready to train: {'YES' if not report.blocking else 'NO'}**",
        "",
        "## Summary",
        f"- Classes: {stats.get('classes', 0)}",
        f"- Images: {stats.get('total_images', 0)} " + "(" + ", ".join(f"{split} {values['images']}" for split, values in stats.get('splits', {}).items()) + ")",
        f"- Annotated boxes: {stats.get('total_boxes', 0)}",
        f"- Background (empty-label) images: {sum(values['background'] for values in stats.get('splits', {}).values())}",
        f"- Classes with annotations: {stats.get('classes_with_annotations', 0)} / {stats.get('classes', 0)}",
        f"- Objects per image: min {stats.get('objects_per_image', {}).get('min', 0)}, max {stats.get('objects_per_image', {}).get('max', 0)}, mean {stats.get('objects_per_image', {}).get('mean', 0)}",
        f"- Class imbalance (most / least annotated class): {stats.get('imbalance_ratio_max_to_min') or 'n/a'}",
    ]
    if "target_images_total" in stats:
        lines.append(f"- Collection target in the manifest: {stats['target_images_total']} images")
    lines += ["", "## Blocking problems", *([f"- {item}" for item in report.blocking] or ["- None"])]
    lines += ["", "## Warnings", *([f"- {item}" for item in report.warnings] or ["- None"])]
    lines += ["", f"## Invalid samples ({len(report.invalid_samples)})",
              "Nothing was removed. Fix or delete these deliberately, then re-run the validator.", ""]
    if report.invalid_samples:
        lines += ["| Split | File | Problem |", "|---|---|---|"]
        lines += [f"| {item['split']} | `{item['file']}` | {item['problem']} |" for item in report.invalid_samples[:500]]
    else:
        lines.append("- None")
    if stats.get("overlapping_classes"):
        lines += ["", "## Classes that look like the same physical part",
                  "One object can't reliably carry two different labels. Merge these, or write down exactly how they differ before annotating.", "",
                  "| Class | Overlaps with | Why |", "|---|---|---|"]
        lines += [f"| {item['a']} | {item['b']} | {item['why']} |" for item in stats["overlapping_classes"]]
    if stats.get("hard_to_separate"):
        lines += ["", "## Different parts that are hard to tell apart on a webcam",
                  "Expect confusion between these unless the images show the distinguishing detail clearly. Check the confusion matrix after training.", "",
                  "| Class | Confused with | Why |", "|---|---|---|"]
        lines += [f"| {item['a']} | {item['b']} | {item['why']} |" for item in stats["hard_to_separate"]]
    if stats.get("instances_per_class") and stats.get("total_images"):
        lines += ["", "## Per-class counts", "", "| ID | Class | Images | Instances |", "|---|---|---|---|"]
        lines += [f"| {index} | {name} | {stats['images_per_class'][name]} | {stats['instances_per_class'][name]}{' ⚠' if stats['instances_per_class'][name] < min_instances else ''} |"
                  for index, name in enumerate(stats["names"])]
    path = report_dir / "dataset_report.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", type=Path, help="dataset folder containing data.yaml")
    parser.add_argument("--report-dir", type=Path, default=None, help="where to write the report (default: <dataset>/reports)")
    parser.add_argument("--min-instances", type=int, default=50, help="warn for classes with fewer annotated instances")
    args = parser.parse_args()
    dataset = args.dataset.resolve()
    report, stats = validate(dataset, args.min_instances)
    path = write_report(dataset, report, stats, args.report_dir or dataset / "reports", args.min_instances)
    print(f"Report: {path}")
    print(f"Ready to train: {'YES' if not report.blocking else 'NO'} ({len(report.blocking)} blocking, {len(report.warnings)} warnings, {len(report.invalid_samples)} invalid samples)")
    for item in report.blocking:
        print(f"  BLOCKING: {item}")
    return 0 if not report.blocking else 1


if __name__ == "__main__":
    sys.exit(main())
