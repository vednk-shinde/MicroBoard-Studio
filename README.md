# MicroBoard Studio

**The bridge between Arduino code, MCU internals and the real board.**
CuriousPARC 2026 · Theme 07 — Build Your Own Boards

MicroBoard Studio is an interactive learning and configuration tool that shows what Arduino code actually does inside the microcontroller, and then lets you see the real board do it over USB.

```
pinMode(13, OUTPUT)      →  D13  →  PB5  →  DDRB bit 5 = 1   →  OUTPUT
digitalWrite(13, HIGH)   →  D13  →  PB5  →  PORTB bit 5 = 1  →  LED ON
```

## Features

| View | What it shows |
|---|---|
| **Pin Explorer** | Every Uno pin with its ATmega328P port/bit and alternate functions (PWM, SPI, I²C, UART, ADC) |
| **Peripheral Mapper** | Which pins each peripheral (UART, SPI, I²C, PWM, ADC) uses |
| **Code Visualizer** | Traces Arduino API calls down to the register bits they change |
| **Register Viewer** | Bit-level `DDRx` / `PORTx` / `PINx` state |
| **Hardware Monitor** | Live pin mode and level read from a connected board over Web Serial |
| **Learn Mode** | Short guided lessons on pins, ports, bits and registers |

## Architecture

```
User ──► MicroBoard UI (React + TypeScript + Vite)
             │  pin data · visualization
             ▼
         Serial layer (Web Serial API, 115200 baud)
             │  MODE / SET / READ / STATUS
             ▼
         Firmware (firmware/microboard_firmware.ino) on Arduino Uno / ATmega328P
```

## Getting started

### Web app

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open the printed URL in **Chrome or Edge** (Web Serial is not supported in Firefox/Safari).

Other scripts: `npm run build`, `npm run preview`, `npm run lint`.

### Firmware

1. Open `firmware/microboard_firmware.ino` in the Arduino IDE.
2. Select **Arduino Uno** and the right COM port, then upload.
3. In the web app, click **Connect** and pick the board's serial port. The board replies `READY`.

## Serial protocol

Newline-terminated text commands at 115200 baud, digital pins D0–D13:

| Command | Response |
|---|---|
| `MODE <pin> OUTPUT\|INPUT\|INPUT_PULLUP` | `OK MODE 13 OUTPUT` |
| `SET <pin> HIGH\|LOW` (pin must be OUTPUT) | `OK SET 13 HIGH` |
| `READ <pin>` | `READ 13 OUTPUT HIGH` |
| `STATUS` | `STATUS D0 INPUT LOW D1 INPUT LOW … D13 OUTPUT HIGH` |

Errors come back as `ERROR <CMD> <REASON>`, e.g. `ERROR SET PIN_NOT_OUTPUT`, `ERROR UNKNOWN_COMMAND`.

## Project structure

```
├── firmware/                 Arduino firmware (serial command protocol)
├── src/
│   ├── App.tsx               App shell, navigation, pages
│   ├── components/           ArduinoBoard, PinExplorer, PeripheralMapper,
│   │                         CodeVisualizer, RegisterViewer
│   ├── data/pins.ts          Uno → ATmega328P pin/port/peripheral map
│   └── services/serial.ts    Web Serial connection + protocol client
├── public/                   Static assets
└── docs/                     Submission deck, project document and plan
```

## Status and roadmap

**Working now:** pin and peripheral views, code-to-register visualization, register viewer, Web Serial link, and live digital I/O through the firmware.

**Next:**
1. Custom MicroBoard PCB with per-pin protection and sensing
2. Conflict-aware pin/peripheral planner
3. Signal and protocol visualization
4. ESP32 / STM32 / RP2040 support

## Docs

- [Submission deck](docs/MicroBoard_Studio_CuriousPARC_Submission.pptx)
- [Project document](docs/MicroBoard_Studio_Project_Document.docx)
- [Project plan](docs/MicroBoard_Studio_Project_Plan.docx)
