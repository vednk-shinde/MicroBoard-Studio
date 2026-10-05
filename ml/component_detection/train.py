"""Fine-tune YOLO11n on the MicroBoard component dataset (transfer learning, not from scratch).

Usage:
    python ml/component_detection/train.py --data ml/datasets/microboard_components_v1/data.yaml [--name v1]

Outputs (Ultralytics run folder): ml/runs/component_detection/<name>/
    weights/best.pt, weights/last.pt, results.csv/png, confusion matrices, PR/F1 curves,
    validation prediction images, plus run_config.json describing exactly how the run was made.
"""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
from pathlib import Path

import torch
from ultralytics import YOLO

# Absolute: Ultralytics 8.4 nests a relative project path under its own runs/detect/ folder.
PROJECT = Path("ml/runs/component_detection").resolve()

# Chosen for a few thousand images and an 8 GB GPU; see the README for the reasoning.
HYPERPARAMETERS = dict(
    imgsz=640,            # matches the browser model input
    epochs=200,
    patience=40,          # early stopping on validation fitness
    batch=16,
    optimizer="auto",
    cos_lr=True,
    warmup_epochs=3,
    close_mosaic=15,      # last epochs on un-mosaicked images, closer to real webcam frames
    # Realistic augmentation only.
    hsv_h=0.015, hsv_s=0.6, hsv_v=0.4,   # lighting / colour variation
    degrees=10.0,                          # small rotations
    translate=0.1, scale=0.5,              # position and distance
    perspective=0.0005,                    # slight camera tilt
    shear=0.0,
    fliplr=0.5,                            # these generic parts look the same mirrored
    flipud=0.0,                            # never upside-down scenes
    mosaic=1.0, mixup=0.0, copy_paste=0.0,
    seed=42,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=False)
    parser.add_argument("--model", default="yolo11n.pt", help="pretrained checkpoint to start from (kept unchanged)")
    parser.add_argument("--name", default="v1")
    parser.add_argument("--epochs", type=int, default=HYPERPARAMETERS["epochs"])
    parser.add_argument("--resume", type=Path, default=None, help="continue an interrupted run from its weights/last.pt")
    parser.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                        help="override a hyperparameter, e.g. --set mixup=0.1 (repeatable)")
    args = parser.parse_args()

    if not torch.cuda.is_available():
        print("WARNING: CUDA not available, training on CPU will be very slow.")
    settings = {**HYPERPARAMETERS, "epochs": args.epochs}
    for item in args.set:
        key, value = item.split("=", 1)
        if key not in HYPERPARAMETERS:
            raise SystemExit(f"Unknown hyperparameter: {key}")
        settings[key] = type(HYPERPARAMETERS[key])(value) if not isinstance(HYPERPARAMETERS[key], bool) else value.lower() == "true"
    if args.resume:
        # Continues with the interrupted run's own settings and folder.
        model = YOLO(str(args.resume))
        model.train(resume=True, workers=2)
        print(f"Run folder: {model.trainer.save_dir}")
        return 0
    model = YOLO(args.model)
    model.train(data=args.data, device=0 if torch.cuda.is_available() else "cpu", workers=4,
                project=str(PROJECT), name=args.name, exist_ok=False, plots=True, save=True, val=True, **settings)

    run_dir = Path(model.trainer.save_dir)
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=False).stdout.strip()
    except OSError:
        commit = ""
    (run_dir / "run_config.json").write_text(json.dumps({
        "base_model": args.model, "data": args.data, "hyperparameters": settings, "git_commit": commit,
        "torch": torch.__version__, "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "python": platform.python_version(), "best": str(run_dir / "weights" / "best.pt"),
    }, indent=2), encoding="utf-8")
    print(f"Run folder: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
