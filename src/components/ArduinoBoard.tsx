import { Activity, Cpu, Lightbulb, Usb } from 'lucide-react'
import { analogPins, digitalPins, type PinDefinition, type PeripheralName } from '../data/pins'

interface ArduinoBoardProps {
  selectedPin: string
  onSelectPin: (pinId: string) => void
  activePeripheral?: PeripheralName | null
  ledOn: boolean
}

function PinButton({
  pin,
  selected,
  highlighted,
  onClick,
}: {
  pin: PinDefinition
  selected: boolean
  highlighted: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`board-pin ${pin.family === 'Analog' ? 'analog' : ''} ${selected ? 'selected' : ''} ${highlighted ? 'highlighted' : ''}`}
      onClick={onClick}
      title={`${pin.id} · ${pin.mcuPin} · ${pin.functions.join(', ')}`}
      aria-label={`Select ${pin.id}, ${pin.mcuPin}, ${pin.functions.join(', ')}`}
    >
      <span className="pin-contact" />
      <span>{pin.id}</span>
    </button>
  )
}

export function ArduinoBoard({ selectedPin, onSelectPin, activePeripheral = null, ledOn }: ArduinoBoardProps) {
  return (
    <section className="panel board-panel" aria-label="Virtual Arduino Uno board">
      <div className="panel-heading board-panel-heading">
        <div>
          <span className="eyebrow">VIRTUAL HARDWARE</span>
          <h2>Arduino Uno R3</h2>
        </div>
        <span className="simulation-tag"><span /> SIMULATION</span>
      </div>

      <div className="uno-board">
        <div className="board-topline">
          <div className="board-brand"><span className="brand-mark">∞</span><span>ARDUINO</span><small>UNO R3</small></div>
          <div className="board-led" aria-label={ledOn ? 'Built-in LED on' : 'Built-in LED off'}>
            <span className={`led-dot ${ledOn ? 'on' : ''}`} />
            <span> L</span>
          </div>
        </div>

        <div className="board-layout">
          <div className="pin-bank digital-bank">
            <div className="pin-bank-label">DIGITAL <span>0—13</span></div>
            <div className="pin-bank-grid digital-pin-grid">
              {digitalPins.map((pin) => (
                <PinButton
                  key={pin.id}
                  pin={pin}
                  selected={selectedPin === pin.id}
                  highlighted={Boolean(activePeripheral && pin.peripherals.includes(activePeripheral))}
                  onClick={() => onSelectPin(pin.id)}
                />
              ))}
            </div>
          </div>

          <div className="mcu-zone">
            <div className="usb-port"><Usb size={15} /><span>USB</span></div>
            <div className="mcu-chip">
              <div className="chip-notch" />
              <Cpu size={27} strokeWidth={1.35} />
              <strong>ATmega328P</strong>
              <span>8-BIT AVR MCU</span>
            </div>
            <div className="board-connector"><Activity size={13} /> USB / SERIAL <span className="disconnected-light" /></div>
          </div>

          <div className="pin-bank analog-bank">
            <div className="pin-bank-label">ANALOG <span>A0—A5</span></div>
            <div className="pin-bank-grid analog-pin-grid">
              {analogPins.map((pin) => (
                <PinButton
                  key={pin.id}
                  pin={pin}
                  selected={selectedPin === pin.id}
                  highlighted={Boolean(activePeripheral && pin.peripherals.includes(activePeripheral))}
                  onClick={() => onSelectPin(pin.id)}
                />
              ))}
            </div>
            <div className="power-bank">
              <span className="pin-bank-label">POWER</span>
              <div className="power-contacts">{['3V3', '5V', 'GND', 'GND', 'VIN'].map((label, index) => <span key={`${label}-${index}`} className={label === 'GND' ? 'ground' : ''}>{label}</span>)}</div>
            </div>
          </div>
        </div>

        <div className="board-footer"><span>ATmega328P · 16 MHz</span><span><Lightbulb size={12} /> D13 BUILT-IN LED</span></div>
      </div>
      <p className="board-caption">Select any pin to inspect its MCU mapping and peripheral functions.</p>
    </section>
  )
}