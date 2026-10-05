import { ArrowDownRight, ArrowRight, Cable, CircleHelp } from 'lucide-react'
import { getPin, peripheralNames, pinMap, type PeripheralName } from '../data/pins'

interface PeripheralMapperProps {
  activePeripheral: PeripheralName | null
  selectedPin: string
  onPeripheralChange: (peripheral: PeripheralName | null) => void
  onSelectPin: (pinId: string) => void
}

const peripheralNotes: Record<PeripheralName, string> = {
  UART: 'Serial receive and transmit signals for asynchronous communication.',
  SPI: 'Synchronous serial bus signals. D10–D13 provide SS, MOSI, MISO and SCK.',
  I2C: 'Two-wire bus signals on the Uno analog header: SDA and SCL.',
  PWM: 'Timer-backed pulse-width modulation outputs available on six digital pins.',
  ADC: 'Six 10-bit analog-to-digital converter input channels.',
  Interrupts: 'External interrupt inputs INT0 and INT1 on D2 and D3.',
}

export function PeripheralMapper({ activePeripheral, selectedPin, onPeripheralChange, onSelectPin }: PeripheralMapperProps) {
  const mappedPins = activePeripheral ? pinMap.filter((pin) => pin.peripherals.includes(activePeripheral)) : []
  const groups = activePeripheral ? [{ peripheral: activePeripheral, pins: mappedPins }] : peripheralNames.map((peripheral) => ({ peripheral, pins: pinMap.filter((pin) => pin.peripherals.includes(peripheral)) }))

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div><span className="eyebrow">ROUTING / PERIPHERAL MAPPER</span><h1>Peripheral map</h1><p>Highlight the Arduino pins assigned to each ATmega328P peripheral.</p></div>
        <div className="title-icon"><Cable size={21} /></div>
      </div>
      <div className="peripheral-layout">
        <section className="panel peripheral-selector">
          <div className="panel-heading"><div><span className="eyebrow">PERIPHERALS</span><h2>Choose a signal group</h2></div><CircleHelp size={16} className="muted-icon" /></div>
          <div className="peripheral-options">
            {peripheralNames.map((peripheral) => {
              const count = pinMap.filter((pin) => pin.peripherals.includes(peripheral)).length
              return <button type="button" key={peripheral} className={`peripheral-option ${activePeripheral === peripheral ? 'active' : ''}`} onClick={() => onPeripheralChange(activePeripheral === peripheral ? null : peripheral)} aria-pressed={activePeripheral === peripheral}>
                <span className="peripheral-option-icon"><Cable size={16} /></span><span className="peripheral-option-text"><strong>{peripheral}</strong><small>{count} mapped pins</small></span><ArrowRight size={15} />
              </button>
            })}
          </div>
          <div className="mapper-footnote"><span className="note-dot" /> Click a peripheral to highlight its routes on the board.</div>
        </section>
        <section className="panel peripheral-results">
          <div className="panel-heading"><div><span className="eyebrow">SIGNAL ROUTES</span><h2>{activePeripheral ?? 'All peripherals'}</h2></div><span className="route-count">{activePeripheral ? mappedPins.length : pinMap.reduce((sum, pin) => sum + pin.peripherals.length, 0)} ROUTES</span></div>
          {activePeripheral && <p className="peripheral-description">{peripheralNotes[activePeripheral]}</p>}
          <div className="route-groups">
            {groups.map(({ peripheral, pins }) => <div className="route-group" key={peripheral}>
              {!activePeripheral && <div className="route-group-title">{peripheral}<span>{pins.length} pins</span></div>}
              <div className="route-list">{pins.map((pin) => {
                const functionLabel = pin.functions.find((fn) => fn.toUpperCase().includes(peripheral === 'I2C' ? 'I2C' : peripheral === 'Interrupts' ? 'INT' : peripheral)) ?? pin.functions.at(-1) ?? pin.functions[0]
                return <button type="button" key={pin.id} className={`route-row ${selectedPin === pin.id ? 'selected' : ''}`} onClick={() => onSelectPin(pin.id)}>
                  <span className="route-pin">{pin.id}</span><ArrowDownRight size={15} className="route-arrow" /><span className="route-mcu">{pin.mcuPin}</span><span className="route-function">{functionLabel}</span><span className="route-bit">BIT {pin.bit}</span>
                </button>
              })}</div>
            </div>)}
          </div>
          <div className="mapper-selection"><span>SELECTED</span><strong>{getPin(selectedPin).id}</strong><ArrowRight size={15} /><strong>{getPin(selectedPin).mcuPin}</strong><span>{getPin(selectedPin).functions.join(' · ')}</span></div>
        </section>
      </div>
    </div>
  )
}