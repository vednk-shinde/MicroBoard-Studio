# Evaluation: `ml\runs\component_detection\v5_all\weights\best.pt`

## Test set (never used for training)

| Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|
| 0.588 | 0.543 | 0.574 | 0.443 |

- Test images fully correct (with per-class thresholds): 103 / 174
- Background images (people, posters, consoles, ...) with a false detection: 4 / 47
- Classes that never reach 90% precision on validation: Breadboard, Diode, Microcontroller_Board, Potentiometer, Resistor, Arduino_Mega, Arduino_Nano, DC_Motor, ESP32_DevBoard, HC-SR04_Ultrasonic, LCD_16x2, PIR_Sensor, Transistor, USB_Cable

## Per class

| Class | Threshold | Precision | Recall | mAP50 | mAP50-95 | FP | FN |
|---|---|---|---|---|---|---|---|
| Battery_Holder | 0.65 | 0.617 | 0.25 | 0.402 | 0.241 | 2 | 12 |
| Breadboard | 0.6 ⚠ | 0.427 | 0.625 | 0.353 | 0.213 | 5 | 3 |
| Capacitor | 0.7 | 0.455 | 0.6 | 0.574 | 0.513 | 4 | 5 |
| Connector | 0.85 | 0.864 | 0.8 | 0.84 | 0.737 | 0 | 3 |
| Crystal_Oscillator | 0.9 | 0.584 | 0.237 | 0.379 | 0.275 | 1 | 11 |
| Diode | 0.6 ⚠ | 0.539 | 0.8 | 0.767 | 0.452 | 2 | 1 |
| Heat_Sink | 0.7 | 0.883 | 0.757 | 0.784 | 0.741 | 0 | 3 |
| Inductor | 0.55 | 0.34 | 0.5 | 0.495 | 0.446 | 2 | 2 |
| Jumper_Wires | 0.65 | 0.68 | 0.667 | 0.615 | 0.422 | 0 | 3 |
| Microcontroller_Board | 0.6 ⚠ | 0.863 | 0.775 | 0.9 | 0.752 | 0 | 7 |
| Potentiometer | 0.6 ⚠ | 0.37 | 0.333 | 0.456 | 0.249 | 3 | 4 |
| Power_Supply_Module | 0.8 | 0.358 | 0.333 | 0.311 | 0.283 | 1 | 1 |
| Resistor | 0.6 ⚠ | 0.496 | 0.286 | 0.347 | 0.205 | 1 | 4 |
| Arduino_Mega | 0.6 ⚠ | - | - | - | - | 0 | 0 |
| Arduino_Nano | 0.6 ⚠ | - | - | - | - | 0 | 0 |
| Arduino_Uno | 0.55 | 0.397 | 0.5 | 0.638 | 0.447 | 0 | 1 |
| DC_Motor | 0.6 ⚠ | - | - | - | - | 0 | 0 |
| ESP32_DevBoard | 0.6 ⚠ | - | - | - | - | 0 | 0 |
| ESP8266_NodeMCU | 0.7 | 0.575 | 0.726 | 0.828 | 0.712 | 0 | 1 |
| HC-SR04_Ultrasonic | 0.6 ⚠ | - | - | - | - | 0 | 0 |
| LCD_16x2 | 0.6 ⚠ | - | - | - | - | 0 | 0 |
| LED | 0.5 | 0.954 | 0.5 | 0.495 | 0.396 | 1 | 1 |
| PIR_Sensor | 0.6 ⚠ | - | - | - | - | 0 | 0 |
| Transistor | 0.6 ⚠ | - | - | - | - | 0 | 0 |
| USB_Cable | 0.6 ⚠ | - | - | - | - | 0 | 0 |

## Most confused classes (ground truth -> predicted)

- Power_Supply_Module -> Microcontroller_Board: 3
- Microcontroller_Board -> Arduino_Uno: 2
- Battery_Holder -> Microcontroller_Board: 1
- Crystal_Oscillator -> DC_Motor: 1
- Jumper_Wires -> Breadboard: 1
- Microcontroller_Board -> Power_Supply_Module: 1
- Resistor -> Diode: 1

## Calibration (test)

| Confidence band | Predictions | Actually correct |
|---|---|---|
| 0.5-0.6 | 1 | 100% |
| 0.6-0.7 | 4 | 50% |
| 0.7-0.8 | 12 | 33% |
| 0.8-0.9 | 53 | 77% |
| 0.9-1.0 | 34 | 71% |

## Speed (GPU, ms per image): {'preprocess': 1.0, 'inference': 4.65, 'loss': 0.0, 'postprocess': 0.77}
## Size: {'best.pt_MB': 5.49}

Per-image results: `test_predictions.csv`. Confusion matrix and curves: `test/`.
