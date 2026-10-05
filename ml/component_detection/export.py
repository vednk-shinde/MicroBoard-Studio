"""Export a trained detector to ONNX for the browser and (optionally) deploy it into the app.

The web app runs ONNX Runtime Web, which can't load .pt files, so best.pt is exported to ONNX.
With --deploy, the model and its metadata (classes, labels, per-class thresholds from evaluate.py,
detection policy) replace ml/deploy/active/, which src/ml/modelMeta.ts imports.

Usage:
    python ml/component_detection/export.py --weights ml/runs/component_detection/v1/weights/best.pt [--deploy]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

# Import order matters on Windows: torch (via ultralytics) must load its bundled VC++ runtime before onnxruntime.
from ultralytics import YOLO
import onnxruntime  # noqa: E402

DEPLOY_DIR = Path("ml/deploy/active")

# Display labels for class names that don't read well with underscores replaced.
LABELS = {"IC_Chip": "IC chip", "LED": "LED", "Microcontroller_Board": "Microcontroller board", "Power_Supply_Module": "Power supply module",
          "Jumper_Wires": "Jumper wires", "Heat_Sink": "Heat sink", "Battery_Holder": "Battery holder", "Crystal_Oscillator": "Crystal oscillator"}

POLICY = {
    "candidateFloor": 0.25,
    "defaultThreshold": 0.6,
    "nmsIou": 0.45,
    "minBoxArea": 0.004,
    "maxBoxArea": 0.9,
    "confirmWindow": 3,
    "confirmHits": 2,
    "maxMisses": 2,
    "ambiguityMargin": 0.15,
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True, type=Path)
    parser.add_argument("--name", default=None, help="model name shown in the app (default: run folder name)")
    parser.add_argument("--deploy", action="store_true")
    args = parser.parse_args()

    run_dir = args.weights.parent.parent
    model = YOLO(str(args.weights))
    names = [model.names[i] for i in sorted(model.names)]
    onnx_path = Path(model.export(format="onnx", imgsz=640, simplify=True, dynamic=False, opset=17))

    # Sanity check: the exported graph must output 4 box values + one score per class.
    session = onnxruntime.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    shape = session.get_outputs()[0].shape
    if shape[1] != 4 + len(names):
        raise SystemExit(f"Unexpected ONNX output shape {shape} for {len(names)} classes")
    print(f"Exported {onnx_path} ({onnx_path.stat().st_size / 1e6:.1f} MB), output {shape}")

    if not args.deploy:
        return 0
    evaluation = run_dir / "evaluation"
    thresholds_file = evaluation / "thresholds.json"
    if not thresholds_file.exists():
        raise SystemExit("Run evaluate.py first: deployment needs per-class thresholds chosen on the validation set.")
    thresholds = json.loads(thresholds_file.read_text(encoding="utf-8"))["classes"]
    metrics = json.loads((evaluation / "metrics.json").read_text(encoding="utf-8"))
    meta = {
        "name": args.name or run_dir.name,
        "description": f"YOLO11n fine-tuned on {len(names)} electronic component classes. Test mAP50 {metrics['test']['mAP50']}, "
                       f"precision {metrics['test']['precision']}, recall {metrics['test']['recall']}.",
        "architecture": "yolo11n",
        "imageSize": 640,
        "source": Path(os.path.relpath(args.weights.resolve(), Path.cwd())).as_posix(),
        "classes": [{"id": i, "name": name, "label": LABELS.get(name, name.replace("_", " ")), "threshold": thresholds[name]["threshold"],
                     **({} if thresholds[name]["reaches_target_precision"] else {"unreliable": True})} for i, name in enumerate(names)],
        "policy": POLICY,
        "thresholdNote": "Per-class thresholds chosen on the validation split as the lowest confidence reaching 90% precision; "
                         "classes marked unreliable never reached it (or have too few validation images to tell) and use 0.6, and the app warns for them.",
        "evaluation": {"test": metrics["test"], "unreliable_classes": metrics["unreliable_classes"],
                       "background_images_with_false_detection": f"{metrics['background_images_with_false_detection']}/{metrics['background_images']}"},
    }
    DEPLOY_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(onnx_path, DEPLOY_DIR / "model.onnx")
    (DEPLOY_DIR / "model_meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"Deployed to {DEPLOY_DIR}: {len(names)} classes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
