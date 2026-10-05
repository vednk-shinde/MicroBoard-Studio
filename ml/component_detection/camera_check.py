"""Repeat-test a model on real webcam-style images, the way the Camera Scanner would see them.

Each image is run N times with random crop / zoom / brightness / blur / noise (like a hand moving a part in front
of a webcam). A run counts as "found" when a detection above that class's deployed threshold appears.
Also reports every class that was predicted, so wrong names are visible and not hidden by a high hit rate.

Usage:
    python ml/component_detection/camera_check.py --weights <best.pt> --meta ml/deploy/active/model_meta.json \
        --image "uno=C:/path/uno.jpg:Microcontroller_Board" --image "face=C:/path/face.jpg:" [--runs 10]
Each --image is label=path:expected_class (empty expected class = nothing should be detected).
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO


def variant(image: np.ndarray, rng: random.Random) -> np.ndarray:
    height, width = image.shape[:2]
    zoom = rng.uniform(1.0, 1.35)
    crop_w, crop_h = int(width / zoom), int(height / zoom)
    x, y = rng.randint(0, width - crop_w), rng.randint(0, height - crop_h)
    out = cv2.resize(image[y:y + crop_h, x:x + crop_w], (width, height))
    if rng.random() < 0.5:
        out = out[:, ::-1]
    out = out.astype(np.float32) * rng.uniform(0.6, 1.15) + rng.uniform(-20, 15)
    out += np.random.default_rng(rng.randint(0, 2**31)).normal(0, rng.uniform(1, 7), out.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    if rng.random() < 0.5:
        out = cv2.GaussianBlur(out, (0, 0), rng.uniform(0.4, 1.4))
    return np.ascontiguousarray(out)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True)
    parser.add_argument("--meta", required=True)
    parser.add_argument("--image", action="append", required=True)
    parser.add_argument("--runs", type=int, default=10)
    args = parser.parse_args()

    meta = json.loads(Path(args.meta).read_text(encoding="utf-8"))
    thresholds = {item["name"]: item["threshold"] for item in meta["classes"]}
    model = YOLO(args.weights)
    rng = random.Random(7)
    print(f"{'image':<14}{'expected':<24}{'found (of ' + str(args.runs) + ')':<14}{'correct':<10}predicted (count, best conf)")
    for spec in args.image:
        label, rest = spec.split("=", 1)
        path, expected = rest.rsplit(":", 1)
        original = cv2.imread(path)
        if original is None:
            print(f"{label:<14}cannot read {path}")
            continue
        found = correct = 0
        seen: dict[str, list[float]] = {}
        for _ in range(args.runs):
            result = model.predict(variant(original, rng), conf=0.05, imgsz=640, verbose=False)[0]
            kept = [(model.names[int(c)], float(s)) for c, s in zip(result.boxes.cls, result.boxes.conf)
                    if float(s) >= thresholds[model.names[int(c)]]]
            if kept:
                found += 1
            names = {name for name, _ in kept}
            correct += (expected in names) if expected else (not names)
            for name, score in kept:
                seen.setdefault(name, []).append(score)
        summary = ", ".join(f"{n} x{len(v)} (best {max(v):.0%})" for n, v in sorted(seen.items(), key=lambda kv: -len(kv[1]))) or "nothing"
        print(f"{label:<14}{expected or '(nothing)':<24}{found:<14}{correct}/{args.runs:<7}{summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
