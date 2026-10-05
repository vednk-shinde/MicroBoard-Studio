# Evaluation: `ml\runs\component_detection\v3_yolo11s\weights\best.pt`

## Test set (never used for training)

| Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|
| 0.587 | 0.435 | 0.491 | 0.369 |

- Test images fully correct (with per-class thresholds): 96 / 161
- Background images (people, posters, consoles, ...) with a false detection: 0 / 47
- Classes that never reach 90% precision on validation: none

## Per class

| Class | Threshold | Precision | Recall | mAP50 | mAP50-95 | FP | FN |
|---|---|---|---|---|---|---|---|
| Battery_Holder | 0.75 | 0.469 | 0.125 | 0.251 | 0.168 | 0 | 14 |
| Breadboard | 0.8 | 0.529 | 0.875 | 0.575 | 0.332 | 5 | 4 |
| Capacitor | 0.7 | 0.532 | 0.333 | 0.367 | 0.289 | 0 | 4 |
| Connector | 0.8 | 0.551 | 0.4 | 0.648 | 0.624 | 0 | 3 |
| Crystal_Oscillator | 0.5 | 0.339 | 0.229 | 0.197 | 0.107 | 2 | 7 |
| Diode | 0.55 | 0.528 | 0.234 | 0.407 | 0.235 | 2 | 4 |
| Heat_Sink | 0.8 | 0.879 | 0.728 | 0.81 | 0.76 | 0 | 2 |
| Inductor | 0.5 | 0.74 | 0.5 | 0.575 | 0.318 | 4 | 2 |
| Jumper_Wires | 0.7 | 0.737 | 0.444 | 0.636 | 0.529 | 0 | 4 |
| Microcontroller_Board | 0.8 | 0.87 | 0.839 | 0.88 | 0.747 | 0 | 9 |
| Potentiometer | 0.8 | 0.448 | 0.333 | 0.397 | 0.157 | 0 | 3 |
| Power_Supply_Module | 0.7 | 0.661 | 0.333 | 0.333 | 0.3 | 0 | 2 |
| Resistor | 0.75 | 0.353 | 0.286 | 0.304 | 0.228 | 0 | 6 |

## Most confused classes (ground truth -> predicted)

- Power_Supply_Module -> Microcontroller_Board: 3
- Battery_Holder -> Crystal_Oscillator: 1
- Connector -> Potentiometer: 1
- Heat_Sink -> Battery_Holder: 1
- Inductor -> Jumper_Wires: 1
- Jumper_Wires -> Breadboard: 1
- Microcontroller_Board -> Power_Supply_Module: 1
- Potentiometer -> Capacitor: 1
- Resistor -> Diode: 1

## Calibration (test)

| Confidence band | Predictions | Actually correct |
|---|---|---|
| 0.5-0.6 | 2 | 0% |
| 0.6-0.7 | 2 | 0% |
| 0.7-0.8 | 6 | 17% |
| 0.8-0.9 | 58 | 74% |
| 0.9-1.0 | 12 | 100% |

## Speed (GPU, ms per image): {'preprocess': 3.16, 'inference': 10.22, 'loss': 0.01, 'postprocess': 1.15}
## Size: {'best.pt_MB': 19.18}

Per-image results: `test_predictions.csv`. Confusion matrix and curves: `test/`.
