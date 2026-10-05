# Evaluation: `ml\runs\component_detection\v1\weights\best.pt`

## Test set (never used for training)

| Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|
| 0.588 | 0.543 | 0.549 | 0.401 |

- Test images fully correct (with per-class thresholds): 92 / 161
- Background images (people, posters, consoles, ...) with a false detection: 3 / 47
- Classes that never reach 90% precision on validation: Capacitor, Jumper_Wires

## Per class

| Class | Threshold | Precision | Recall | mAP50 | mAP50-95 | FP | FN |
|---|---|---|---|---|---|---|---|
| Battery_Holder | 0.5 | 0.771 | 0.214 | 0.352 | 0.182 | 1 | 13 |
| Breadboard | 0.5 | 0.471 | 0.75 | 0.514 | 0.255 | 5 | 2 |
| Capacitor | 0.9 ⚠ | 0.672 | 0.5 | 0.57 | 0.432 | 0 | 6 |
| Connector | 0.5 | 0.622 | 0.6 | 0.795 | 0.725 | 2 | 2 |
| Crystal_Oscillator | 0.65 | 0.0 | 0.0 | 0.075 | 0.023 | 1 | 8 |
| Diode | 0.7 | 0.613 | 0.8 | 0.662 | 0.295 | 0 | 3 |
| Heat_Sink | 0.5 | 0.942 | 0.8 | 0.824 | 0.718 | 0 | 3 |
| Inductor | 0.5 | 0.392 | 0.75 | 0.62 | 0.508 | 4 | 1 |
| Jumper_Wires | 0.9 ⚠ | 0.858 | 0.556 | 0.735 | 0.548 | 0 | 8 |
| Microcontroller_Board | 0.75 | 0.895 | 0.855 | 0.916 | 0.772 | 1 | 10 |
| Potentiometer | 0.8 | 0.421 | 0.5 | 0.359 | 0.218 | 0 | 6 |
| Power_Supply_Module | 0.5 | 0.405 | 0.333 | 0.348 | 0.287 | 0 | 3 |
| Resistor | 0.85 | 0.578 | 0.397 | 0.363 | 0.254 | 1 | 7 |

## Most confused classes (ground truth -> predicted)

- Microcontroller_Board -> Power_Supply_Module: 2
- Crystal_Oscillator -> Potentiometer: 1
- Jumper_Wires -> Breadboard: 1
- Power_Supply_Module -> Microcontroller_Board: 1

## Calibration (test)

| Confidence band | Predictions | Actually correct |
|---|---|---|
| 0.5-0.6 | 6 | 50% |
| 0.6-0.7 | 2 | 50% |
| 0.7-0.8 | 11 | 55% |
| 0.8-0.9 | 34 | 74% |
| 0.9-1.0 | 21 | 90% |

## Speed (GPU, ms per image): {'preprocess': 4.16, 'inference': 18.61, 'loss': 0.0, 'postprocess': 2.9}
## Size: {'best.pt_MB': 5.47, 'best.onnx_MB': 10.61}

Per-image results: `test_predictions.csv`. Confusion matrix and curves: `test/`.
