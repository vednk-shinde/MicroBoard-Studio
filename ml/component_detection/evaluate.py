"""Evaluate a trained detector honestly and choose per-class confidence thresholds.

1. Standard metrics on the held-out TEST split (precision, recall, mAP50, mAP50-95, per class, confusion matrix).
2. Per-class thresholds chosen on the VAL split: the lowest confidence at which the class reaches the
   target precision (default 0.90). Classes that never reach it are flagged as unreliable.
3. Per-image test table (ground truth vs prediction), false positives (including any detection on
   background/hard-negative images), false negatives and confused class pairs, using those thresholds.
4. Calibration: how often a prediction in each confidence band is actually right.

Usage:
    python ml/component_detection/evaluate.py --weights ml/runs/component_detection/v1/weights/best.pt \
        --data ml/datasets/microboard_components_v1/data.yaml
Writes <run>/evaluation/{report.md, metrics.json, thresholds.json, test_predictions.csv}.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import torch
import yaml
from ultralytics import YOLO

MATCH_IOU = 0.5


def iou(a, b) -> float:
    width = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    height = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = width * height
    return inter / max((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter, 1e-9)


def load_ground_truth(label_path: Path, width: int, height: int) -> list[tuple[int, list[float]]]:
    boxes = []
    if label_path.exists():
        for line in label_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            cls, x, y, w, h = line.split()
            x, y, w, h = float(x) * width, float(y) * height, float(w) * width, float(h) * height
            boxes.append((int(cls), [x - w / 2, y - h / 2, x + w / 2, y + h / 2]))
    return boxes


def predict_split(model: YOLO, dataset_root: Path, split: str) -> list[dict]:
    """All predictions (conf >= 0.01) and ground truth for every image of a split."""
    records = []
    image_dir = dataset_root / "images" / split
    for image_path in sorted(image_dir.glob("*.jpg")):
        result = model.predict(str(image_path), conf=0.01, iou=0.6, device=0 if torch.cuda.is_available() else "cpu", verbose=False)[0]
        height, width = result.orig_shape
        predictions = [(int(c), float(s), b) for c, s, b in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist(), result.boxes.xyxy.tolist())]
        truth = load_ground_truth(dataset_root / "labels" / split / f"{image_path.stem}.txt", width, height)
        records.append({"image": image_path.name, "predictions": predictions, "truth": truth})
    return records


def match(record: dict, thresholds: dict[int, float]):
    """Greedy matching of kept predictions to ground truth. Returns (tp, confused, fp, fn) lists."""
    kept = sorted([p for p in record["predictions"] if p[1] >= thresholds.get(p[0], 0.5)], key=lambda p: -p[1])
    unmatched = list(range(len(record["truth"])))
    tp, confused, fp = [], [], []
    for cls, conf, box in kept:
        best, best_iou = None, MATCH_IOU
        for index in unmatched:
            overlap = iou(box, record["truth"][index][1])
            if overlap >= best_iou:
                best, best_iou = index, overlap
        if best is None:
            fp.append((cls, conf))
            continue
        unmatched.remove(best)
        truth_cls = record["truth"][best][0]
        (tp if truth_cls == cls else confused).append((truth_cls, cls, conf))
    fn = [record["truth"][index][0] for index in unmatched]
    return tp, confused, fp, fn


def choose_thresholds(records: list[dict], class_count: int, target: float) -> tuple[dict[int, float], dict[int, dict]]:
    thresholds, detail = {}, {}
    candidates = [round(0.25 + 0.05 * step, 2) for step in range(15)]  # 0.25 .. 0.95
    for cls in range(class_count):
        chosen, info = None, {}
        for threshold in candidates:
            tp = fp = 0
            for record in records:
                kept = [p for p in record["predictions"] if p[0] == cls and p[1] >= threshold]
                truth = [box for c, box in record["truth"] if c == cls]
                used = set()
                for _, _, box in sorted(kept, key=lambda p: -p[1]):
                    hit = next((i for i, t in enumerate(truth) if i not in used and iou(box, t) >= MATCH_IOU), None)
                    if hit is None:
                        fp += 1
                    else:
                        used.add(hit)
                        tp += 1
            total_truth = sum(1 for record in records for c, _ in record["truth"] if c == cls)
            precision = tp / (tp + fp) if tp + fp else 0.0
            recall = tp / total_truth if total_truth else 0.0
            info[threshold] = {"precision": round(precision, 3), "recall": round(recall, 3)}
            if chosen is None and tp + fp and precision >= target:
                chosen = threshold
        reliable = chosen is not None
        thresholds[cls] = chosen if reliable else 0.9
        detail[cls] = {"threshold": thresholds[cls], "reaches_target_precision": reliable, "curve": info}
    return thresholds, detail


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True, type=Path)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--target-precision", type=float, default=0.90)
    args = parser.parse_args()

    out = args.weights.parent.parent / "evaluation"
    out.mkdir(parents=True, exist_ok=True)
    config = yaml.safe_load(args.data.read_text(encoding="utf-8"))
    names = config["names"] if isinstance(config["names"], list) else [config["names"][i] for i in sorted(config["names"])]
    root = args.data.parent
    model = YOLO(str(args.weights))

    # 1. Standard metrics on the untouched test split.
    test_metrics = model.val(data=str(args.data), split="test", imgsz=640, batch=16, plots=True, project=str(out), name="test", exist_ok=True,
                             device=0 if torch.cuda.is_available() else "cpu", verbose=False)
    box = test_metrics.box
    per_class = {}
    for position, cls in enumerate(box.ap_class_index.tolist()):
        per_class[names[cls]] = {"precision": round(float(box.p[position]), 3), "recall": round(float(box.r[position]), 3),
                                 "mAP50": round(float(box.ap50[position]), 3), "mAP50-95": round(float(box.ap[position]), 3)}

    # 2. Thresholds from the validation split.
    val_records = predict_split(model, root, "val")
    thresholds, threshold_detail = choose_thresholds(val_records, len(names), args.target_precision)

    # 3. Per-image test analysis with those thresholds.
    test_records = predict_split(model, root, "test")
    rows, fp_counter, fn_counter, confused_counter = [], Counter(), Counter(), Counter()
    background_images = background_fp_images = 0
    bins = defaultdict(lambda: [0, 0])  # confidence band -> [correct, total]
    for record in test_records:
        tp, confused, fp, fn = match(record, thresholds)
        for cls, conf in fp:
            fp_counter[names[cls]] += 1
        for cls in fn:
            fn_counter[names[cls]] += 1
        for truth_cls, pred_cls, _ in confused:
            confused_counter[(names[truth_cls], names[pred_cls])] += 1
        if not record["truth"]:
            background_images += 1
            background_fp_images += bool(fp)
        for _, _, conf in tp:
            band = min(int(conf * 10), 9)
            bins[band][0] += 1
            bins[band][1] += 1
        for _, _, conf in confused:
            bins[min(int(conf * 10), 9)][1] += 1
        for _, conf in fp:
            bins[min(int(conf * 10), 9)][1] += 1
        truth_names = ", ".join(sorted(names[c] for c, _ in record["truth"])) or "(no component)"
        predicted = sorted([(names[p], c) for _, p, c in tp] + [(names[p], c) for _, p, c in confused] + [(names[c], s) for c, s in fp], key=lambda item: -item[1])
        prediction_text = ", ".join(f"{name} {conf:.0%}" for name, conf in predicted) or "Unknown / nothing"
        correct = not fp and not fn and not confused
        rows.append({"image": record["image"], "ground_truth": truth_names, "prediction": prediction_text, "correct": "yes" if correct else "no"})

    with (out / "test_predictions.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["image", "ground_truth", "prediction", "correct"])
        writer.writeheader()
        writer.writerows(rows)
    calibration = {f"{band / 10:.1f}-{(band + 1) / 10:.1f}": {"predictions": total, "actually_correct": round(correct / total, 3)}
                   for band, (correct, total) in sorted(bins.items()) if total}
    speed = {key: round(value, 2) for key, value in test_metrics.speed.items()}
    sizes = {"best.pt_MB": round(args.weights.stat().st_size / 1e6, 2)}
    onnx_path = args.weights.with_suffix(".onnx")
    if onnx_path.exists():
        sizes["best.onnx_MB"] = round(onnx_path.stat().st_size / 1e6, 2)

    metrics = {
        "test": {"precision": round(float(box.mp), 3), "recall": round(float(box.mr), 3), "mAP50": round(float(box.map50), 3), "mAP50-95": round(float(box.map), 3)},
        "per_class": per_class, "thresholds": {names[c]: t for c, t in thresholds.items()},
        "unreliable_classes": [names[c] for c, d in threshold_detail.items() if not d["reaches_target_precision"]],
        "test_images": len(test_records), "test_images_fully_correct": sum(row["correct"] == "yes" for row in rows),
        "background_images": background_images, "background_images_with_false_detection": background_fp_images,
        "false_positives": dict(fp_counter), "false_negatives": dict(fn_counter),
        "confused_pairs": {f"{a} -> {b}": n for (a, b), n in confused_counter.most_common()},
        "calibration": calibration, "speed_ms_per_image_gpu": speed, "model_size": sizes,
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (out / "thresholds.json").write_text(json.dumps({"target_precision": args.target_precision, "classes": {names[c]: d for c, d in threshold_detail.items()}}, indent=2), encoding="utf-8")

    lines = [f"# Evaluation: `{args.weights}`", "", "## Test set (never used for training)", "",
             "| Precision | Recall | mAP50 | mAP50-95 |", "|---|---|---|---|",
             f"| {metrics['test']['precision']} | {metrics['test']['recall']} | {metrics['test']['mAP50']} | {metrics['test']['mAP50-95']} |", "",
             f"- Test images fully correct (with per-class thresholds): {metrics['test_images_fully_correct']} / {len(test_records)}",
             f"- Background images (people, posters, consoles, ...) with a false detection: {background_fp_images} / {background_images}",
             f"- Classes that never reach {args.target_precision:.0%} precision on validation: {', '.join(metrics['unreliable_classes']) or 'none'}", "",
             "## Per class", "", "| Class | Threshold | Precision | Recall | mAP50 | mAP50-95 | FP | FN |", "|---|---|---|---|---|---|---|---|"]
    for cls, name in enumerate(names):
        stats = per_class.get(name, {})
        flag = "" if threshold_detail[cls]["reaches_target_precision"] else " ⚠"
        lines.append(f"| {name} | {thresholds[cls]}{flag} | {stats.get('precision', '-')} | {stats.get('recall', '-')} | {stats.get('mAP50', '-')} | {stats.get('mAP50-95', '-')} | {fp_counter[name]} | {fn_counter[name]} |")
    lines += ["", "## Most confused classes (ground truth -> predicted)", ""] + ([f"- {k}: {v}" for k, v in metrics["confused_pairs"].items()] or ["- none"])
    lines += ["", "## Calibration (test)", "", "| Confidence band | Predictions | Actually correct |", "|---|---|---|"]
    lines += [f"| {band} | {v['predictions']} | {v['actually_correct']:.0%} |" for band, v in calibration.items()]
    lines += ["", f"## Speed (GPU, ms per image): {speed}", f"## Size: {sizes}", "", "Per-image results: `test_predictions.csv`. Confusion matrix and curves: `test/`."]
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:14]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
