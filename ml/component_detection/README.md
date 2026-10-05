# Component detection (Camera Scanner model)

The Camera Scanner runs a YOLO11n detector in the browser (ONNX, onnxruntime-web: WebGPU, else WebAssembly).
It is fine-tuned from the COCO-pretrained `yolo11n.pt`; that file is never modified, and every training run
writes to its own folder under `ml/runs/component_detection/<name>/`.

The latest evaluation results are in [`reports/`](reports/). The currently deployed model and its metadata are in
`ml/deploy/active/` (`model.onnx` + `model_meta.json`), and the app reads both from there.

## Results (held-out test split: 161 images, 47 of them background/people)

| Run | Model | Test P | Test R | mAP50 | mAP50-95 | Background false detections | Deployed |
|---|---|---|---|---|---|---|---|
| v1 | YOLO11n, default augmentation | 0.588 | 0.543 | **0.549** | **0.401** | 3 / 47 (all below 52% confidence) | **yes** |
| v2 | YOLO11n + mixup 0.1, scale 0.6, rotation 15° | — | — | val 0.617 (below v1's 0.686), stopped | — | — | no |
| v3 | YOLO11s (3.6× larger) | 0.587 | 0.435 | 0.491 | 0.369 | 0 / 47 | no |

v1 was kept: it is better on validation and test, and about 3× faster in the browser. The larger model did not help,
so the limit is the data (about 700 noisy web photos), not model size. Per-class results:

| Class | v1 test mAP50 | Note |
|---|---|---|
| Microcontroller_Board | 0.92 | reliable (Arduino/ESP/Pi boards are one class) |
| Heat_Sink | 0.82 | reliable |
| Connector | 0.80 | |
| Jumper_Wires | 0.74 | flagged unreliable (never reached 90% precision on val) |
| Diode | 0.66 | |
| Inductor | 0.62 | only 4 test images |
| Capacitor | 0.57 | flagged unreliable |
| Breadboard | 0.51 | |
| Resistor | 0.36 | weak |
| Potentiometer | 0.36 | weak |
| Battery_Holder | 0.35 | weak, low recall |
| Power_Supply_Module | 0.35 | weak, confused with Microcontroller_Board |
| Crystal_Oscillator | 0.08 | not usable |

Not trainable from the supplied data (fewer than 25 usable images): Fuse, IC_Chip, LED, Relay, Switch, Transformer,
Transistor. No images exist at all for HC-SR04, MPU6050, DHT11 or servos. Full reports, per-image tables and
confusion matrices are in `reports/model_v1/` and `reports/model_v3_yolo11s/`.

## Pipeline

| Step | Script | Output |
|---|---|---|
| 1. Validate a supplied YOLO dataset | `validate_dataset.py` | `reports/<name>/dataset_report.{md,json}` (nothing is deleted; problems are listed) |
| 2. Import a folder-per-class image archive | `import_classification_set.py` | verified RGB JPEGs + `import_report.md` |
| 3. Clean + box the images | `autolabel.py` | YOLO labels, `autolabel_log.csv` (every keep/reject decision), contact sheets |
| 4. Build the dataset | `build_dataset.py` | train/val/test (70/15/15) with hard negatives, no near-duplicate leakage, `build_report.md` |
| 5. Train | `train.py` | `ml/runs/component_detection/<name>/` (weights, curves, `run_config.json`) |
| 6. Evaluate | `evaluate.py` | `<run>/evaluation/` (test metrics, per-class thresholds, per-image table, calibration) |
| 7. Export + deploy | `export.py --deploy` | `<run>/weights/best.onnx`, `ml/deploy/active/` |

### Why auto-labelling?
The supplied `MicroBoard_YOLO_Expanded_Dataset_v2.zip` contains the class list, manifest and folder layout but
**no images**, and `archive.zip` is a *classification* set (one folder per class, no boxes) with a lot of noise
(people, posters, game consoles, drawings). `autolabel.py` uses CLIP (zero-shot) to reject images that are
not photos of the part, YOLO-World (open vocabulary, prompted with the class name only) to draw the box,
and a CLIP check on the crop to reject boxes that look like a different component. Rejected images of
people, posters, consoles and so on become **hard negatives** (empty label files), which teach the model that
those things are not components. The contact sheets `review_kept.jpg` and `review_rejected.jpg` let you
spot-check the decisions. Expect about 10% label noise anyway; hand-correcting labels is the best next improvement.

### Unknown-object policy (browser)
A class name is shown only when all of these hold (`src/ml/detectionPolicy.ts`, settings in `model_meta.json`):
- the class's own threshold is passed (chosen on the validation split as the lowest confidence that
  reaches 90% precision, never below 0.50; classes that never reach it use 0.90 and are flagged `unreliable`)
- it is passed in 2 of the last 3 frames for the same tracked object
- the box is a plausible size (not a speck, not the whole frame)
- the runner-up class isn't within the ambiguity margin (otherwise "Not sure: A or B?")

Otherwise the app says **"Unknown / no supported component detected"**. A detection is visual only: it never
means the part is wired correctly or working (only the Hardware Monitor / Web Serial connection can check that).

## Commands

Windows, from the repository root. The training environment is a separate venv (Python 3.12, CUDA PyTorch):

```bash
uv venv ml/.venv-train --python 3.12
uv pip install --python ml/.venv-train/Scripts/python.exe torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python ml/.venv-train/Scripts/python.exe ultralytics onnx onnxslim onnxruntime "git+https://github.com/ultralytics/CLIP.git"
```

Base weights go in `ml/weights/` (`yolo11n.pt`; `yolov8x-worldv2.pt` and `clip/ViT-B-32.pt` for auto-labelling only).

**Validate**
```bash
ml/.venv-train/Scripts/python.exe ml/component_detection/validate_dataset.py ml/datasets/microboard_components_v1 --report-dir ml/component_detection/reports/components_v1
```

**Rebuild the dataset** (only when the source images change)
```bash
ml/.venv-train/Scripts/python.exe ml/component_detection/import_classification_set.py archive.zip ml/datasets/components20_source
ml/.venv-train/Scripts/python.exe ml/component_detection/autolabel.py ml/datasets/components20_source ml/datasets/components20_labeled
ml/.venv-train/Scripts/python.exe ml/component_detection/build_dataset.py ml/datasets/components20_labeled ml/datasets/components20_source ml/datasets/microboard_components_v1
```

**Train** (writes `ml/runs/component_detection/<name>/`; if that folder exists, a number is appended instead of overwriting it)
```bash
ml/.venv-train/Scripts/python.exe ml/component_detection/train.py --data ml/datasets/microboard_components_v1/data.yaml --model ml/weights/yolo11n.pt --name v3
```
Override a hyperparameter with `--set key=value` (repeatable), e.g. `--set mixup=0.1 --set patience=60`.

**Evaluate** (held-out test split; also picks the per-class thresholds on the val split)
```bash
ml/.venv-train/Scripts/python.exe ml/component_detection/evaluate.py --weights ml/runs/component_detection/v3/weights/best.pt --data ml/datasets/microboard_components_v1/data.yaml
```

**Export to ONNX and deploy to the app**
```bash
ml/.venv-train/Scripts/python.exe ml/component_detection/export.py --weights ml/runs/component_detection/v3/weights/best.pt --deploy
```

**Run the webcam app / build**
```bash
npm run dev
```
```bash
npm run build
```
Open the **Camera Scanner** page and allow camera access. Nothing leaves the browser.

## Retraining with your own webcam photos (recommended)
The current images are web photos, not webcam frames, which is the biggest reason real-world accuracy is lower
than the test numbers. To improve it:
1. Take 50 to 100 photos per part with the webcam you'll use (different angles, distances, lighting, backgrounds,
   several parts together), plus 100 or more photos of your desk, hands and face with **no** components (hard negatives).
2. Label them in YOLO format (for example with Label Studio or CVAT) using the class names from `data.yaml`.
   Leave the label file empty for the negatives.
3. Add them to `ml/datasets/microboard_components_v1/images/train` + `labels/train` (keep some for val/test), run
   `validate_dataset.py`, then train, evaluate and export as above. Deploy only if the new test metrics are better.
To add a class (e.g. HC-SR04, MPU6050, servo), add it to `names` in `data.yaml`, add at least 25 labelled images and
retrain; `export.py` writes the new class list into `model_meta.json`, and the app picks it up automatically.

## Windows environment notes
- If Python crashes with `OPENSSL_Uplink ... no OPENSSL_Applink`, an antivirus (here Norton) has set
  `SSLKEYLOGFILE`. Run with it unset: `env -u SSLKEYLOGFILE ml/.venv-train/Scripts/python.exe ...` (Git Bash).
- If `import torch` fails with `WinError 1114` (c10.dll), the system Visual C++ runtime is too old. Install the
  latest VC++ 2015-2022 x64 redistributable, or copy a newer `msvcp140.dll`, `vcruntime140.dll`,
  `vcruntime140_1.dll` and `concrt140.dll` into `ml/.venv-train/Lib/site-packages/torch/lib`.
- `data.yaml` must use an absolute `path:`; `build_dataset.py` writes it that way.

## Latest model: v5 (deployed) - 25 classes

Trained on the original photos + `component_dataset` (Arduino boards and sensors, 81 of 293 images removed by eye)
+ about 3,900 generated webcam-style scenes. Pipeline: `label_small_set.py` -> `merge_new_set.py` ->
`synthesize_scenes.py` -> `train.py` -> `evaluate.py` -> `export.py --deploy`; `camera_check.py` repeats a test on real
webcam screenshots. Reports: `reports/model_v5_all/`.

| | v1 | v5 (deployed) |
|---|---|---|
| Classes | 13 | 25 |
| Test mAP50 / mAP50-95 | 0.549 / 0.401 | 0.574 / 0.443 |
| Background images with a false detection | 3 / 47 | 4 / 47 |
| Real webcam screenshot of an Arduino Uno, found in 10 runs | 0 | 8 (named "Microcontroller board", 91-95%) |
| Real webcam screenshot of an HC-SR04, found in 10 runs | 0 | 0 |

Honest limits: Arduino_Uno/Nano/Mega, ESP32, HC-SR04, PIR, LCD, USB cable, DC motor and transistor have only 3-11 training
photos and no (or 1-2) test photos, so they are marked `unreliable` (threshold 0.6, warning in the app). Servo, DHT11,
MPU6050, stepper, buzzer, relay and OLED had too few usable photos and are not trained. More real webcam photos of each part
are the fix; add them and retrain with the commands above.
