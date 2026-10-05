# Evaluation: `ml\runs\component_detection\v4_scenes\weights\best.pt`

## Test set (never used for training)

| Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|
| 0.632 | 0.523 | 0.529 | 0.392 |

- Test images fully correct (with per-class thresholds): 103 / 161
- Background images (people, posters, consoles, ...) with a false detection: 1 / 47
- Classes that never reach 90% precision on validation: Battery_Holder, Capacitor, Potentiometer, Resistor

## Per class

| Class | Threshold | Precision | Recall | mAP50 | mAP50-95 | FP | FN |
|---|---|---|---|---|---|---|---|
| Battery_Holder | 0.9 ⚠ | 0.691 | 0.312 | 0.392 | 0.173 | 0 | 16 |
| Breadboard | 0.7 | 0.493 | 0.75 | 0.471 | 0.265 | 5 | 2 |
| Capacitor | 0.9 ⚠ | 0.481 | 0.333 | 0.309 | 0.192 | 0 | 6 |
| Connector | 0.85 | 0.556 | 0.8 | 0.689 | 0.664 | 0 | 2 |
| Crystal_Oscillator | 0.5 | 0.491 | 0.222 | 0.156 | 0.078 | 2 | 7 |
| Diode | 0.6 | 1.0 | 0.512 | 0.728 | 0.416 | 1 | 2 |
| Heat_Sink | 0.5 | 0.865 | 0.8 | 0.795 | 0.749 | 1 | 2 |
| Inductor | 0.65 | 0.166 | 0.25 | 0.273 | 0.236 | 3 | 3 |
| Jumper_Wires | 0.9 | 0.843 | 0.778 | 0.759 | 0.591 | 0 | 8 |
| Microcontroller_Board | 0.5 | 0.854 | 0.925 | 0.961 | 0.801 | 2 | 3 |
| Potentiometer | 0.9 ⚠ | 0.656 | 0.5 | 0.592 | 0.372 | 0 | 5 |
| Power_Supply_Module | 0.85 | 0.459 | 0.333 | 0.429 | 0.42 | 0 | 1 |
| Resistor | 0.9 ⚠ | 0.661 | 0.281 | 0.324 | 0.142 | 0 | 7 |

## Most confused classes (ground truth -> predicted)

- Power_Supply_Module -> Microcontroller_Board: 3

## Calibration (test)

| Confidence band | Predictions | Actually correct |
|---|---|---|
| 0.5-0.6 | 1 | 100% |
| 0.6-0.7 | 3 | 0% |
| 0.7-0.8 | 7 | 86% |
| 0.8-0.9 | 34 | 85% |
| 0.9-1.0 | 36 | 78% |

## Speed (GPU, ms per image): {'preprocess': 1.05, 'inference': 5.84, 'loss': 0.0, 'postprocess': 0.93}
## Size: {'best.pt_MB': 5.47}

Per-image results: `test_predictions.csv`. Confusion matrix and curves: `test/`.
