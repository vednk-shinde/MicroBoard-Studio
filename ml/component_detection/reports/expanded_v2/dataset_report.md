# Dataset report: `MicroBoard_YOLO_Dataset`

**Ready to train: NO**

## Summary
- Classes: 182
- Images: 0 (train 0, val 0)
- Annotated boxes: 0
- Background (empty-label) images: 0
- Classes with annotations: 0 / 182
- Objects per image: min 0, max 0, mean 0
- Class imbalance (most / least annotated class): n/a
- Collection target in the manifest: 27290 images

## Blocking problems
- train: image directory does not exist: C:\Users\vedan\AppData\Local\Temp\mbds\MicroBoard_YOLO_Dataset\images\train
- val: image directory does not exist: C:\Users\vedan\AppData\Local\Temp\mbds\MicroBoard_YOLO_Dataset\images\val
- The dataset contains no images, so there is nothing to train on

## Warnings
- 41 class pairs look like the same physical part or overlap; merge them (or define them precisely) before annotating, or the detector will be trained on contradictory labels
- data.yaml has no test split: a held-out test set is needed for honest evaluation

## Invalid samples (0)
Nothing was removed. Fix or delete these deliberately, then re-run the validator.

- None

## Classes that look like the same physical part
One object can't reliably carry two different labels. Merge these, or write down exactly how they differ before annotating.

| Class | Overlaps with | Why |
|---|---|---|
| GY521 | MPU6050 | GY-521 is the common MPU6050 breakout board |
| SSD1306_OLED | OLED_0.96 | the usual 0.96" OLED module is an SSD1306 128x64 |
| SSD1306_OLED | OLED_128x64 | same SSD1306 128x64 module |
| OLED_0.96 | OLED_128x64 | same 0.96" 128x64 module |
| RFID_RFID522 | RC522 | same MFRC522 RFID reader |
| PN532_NFC | PN532 | same PN532 NFC module |
| Gas_MQ2 | MQ2_Gas_Sensor | same MQ-2 module |
| NEO6M_GPS | GPS_NEO6M | same NEO-6M GPS module |
| PIR_HC_SR501 | HC_SR501_PIR | same HC-SR501 PIR module |
| PIR_Sensor | HC_SR501_PIR | generic PIR label overlaps the specific HC-SR501 |
| L298N_Module | L298N | an L298N is normally sold as this module |
| TB6612FNG_Module | TB6612FNG | same breakout |
| MAX7219_8x8 | MAX7219_Module | MAX7219 module is usually the 8x8 matrix board |
| MAX7219_8x8 | LED_Matrix_8x8 | an 8x8 matrix is usually driven by a MAX7219 board |
| Rotary_Encoder_KY040 | Rotary_Encoder | KY-040 is the common rotary encoder module |
| TTP223_Touch | Touch_Sensor_TTP223 | same TTP223 touch module |
| Logic_Level_Converter | Logic_Level_Shifter | same part, different name |
| USB_TTL_CP2102 | USB_TTL | generic label overlaps the specific adapters |
| USB_TTL_CH340 | USB_TTL | generic label overlaps the specific adapters |
| Relay_5V | Relay_Module | a 5 V relay module is the common relay module |
| Screw_Terminal | Terminal_Block | same part |
| Rain_Drop_Module | Rain_Sensor | same rain sensor board |
| KY038_Sound_Module | Sound_Sensor | KY-038 is the common sound sensor module |
| Soil_Moisture_Capacitive | Soil_Moisture_Sensor | generic label overlaps the specific type |
| NodeMCU_ESP8266 | ESP8266_Module | overlap unless ESP8266_Module means only the ESP-01 |
| Gamepad_Joystick | Joystick_Module | overlap unless they are visually different products |
| 7Segment_4Digit | Seven_Segment | overlap unless Seven_Segment means single digit only |
| TM1637_4Digit | 7Segment_4Digit | TM1637 boards are 4-digit 7-segment displays |
| Jumper_Wires | Dupont_Male_Male | generic label overlaps the specific Dupont types |
| Buzzer | Active_Buzzer | generic label overlaps; active/passive buzzers often look identical |
| Buzzer | Passive_Buzzer | generic label overlaps; active/passive buzzers often look identical |
| Capacitor | Electrolytic_Capacitor | generic label overlaps the specific types |
| Capacitor | Ceramic_Capacitor | generic label overlaps the specific types |
| LED_5mm | LED_Red | size and colour are different properties: a red 5 mm LED fits both labels |
| LED_3mm | LED_Red | size and colour are different properties of the same object |
| NeoPixel_Strip | LED_Strip | overlap unless LED_Strip means non-addressable only |
| NeoPixel_Ring | WS2812B | NeoPixel rings are WS2812B LEDs |
| Stepper_A4988 | DRV8825 | visually near-identical driver carriers (only the chip marking differs) |
| LDR_Module | LDR | module vs bare part: OK if annotated consistently |
| TCRT5000_Module | TCRT5000_IR_Sensor | overlap unless one means the bare sensor |
| RTC_DS1307 | DS3231_RTC | different chips, but modules can look very similar |

## Different parts that are hard to tell apart on a webcam
Expect confusion between these unless the images show the distinguishing detail clearly. Check the confusion matrix after training.

| Class | Confused with | Why |
|---|---|---|
| HC_SR04 | HC_SR04_Mini | same transducer layout; size is the main cue |
| HC_SR04 | US_100 | very similar dual-transducer boards |
| DHT11 | DHT22 | blue vs white housing; reliable only if colour is visible |
| MPU6050 | MPU9250 | breakouts look similar; chip marking is too small for a webcam |
| MPU6050 | MPU6500 | same breakout style; chip marking is too small for a webcam |
| BMP280 | BME280 | identical breakouts; only the chip marking differs |
| BMP180 | BMP280 | small purple breakouts with similar layouts |
| HC05_Bluetooth | HC06_Bluetooth | same module family; often only pin count differs |
| Active_Buzzer | Passive_Buzzer | often identical apart from a sealed bottom |
| L293D | L298N | different packages; fine as bare chip vs module, hard if both are shields |
| SG90_Servo | MG996R_Servo | different sizes; fine if scale is visible |
| Arduino_Uno | Arduino_Leonardo | same form factor; USB connector and chip are the cues |
| Resistor | 1N4007_Diode | small axial parts; needs close-up images |
