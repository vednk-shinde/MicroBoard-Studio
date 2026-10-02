import { Binary, MousePointer2 } from 'lucide-react'
import { pinForPortBit, type PinDefinition, type PinLevel, type PinMode } from '../data/pins'

interface RegisterViewerProps {
  selectedPin: PinDefinition
  modes: Record<string, PinMode>
  levels: Record<string, PinLevel>
  onSelectPin: (pinId: string) => void
  onTogglePin: (pinId: string) => void
}

function registerValue(register: 'DDR' | 'PORT' | 'PIN', port: PinDefinition['port'], modes: Record<string, PinMode>, levels: Record<string, PinLevel>) {
  let value = 0
  for (let bit = 0; bit < 8; bit += 1) {
    const pin = pinForPortBit(port, bit)
    if (!pin) continue
    const mode = modes[pin.id] ?? 'INPUT'
    const level = levels[pin.id] ?? 'LOW'
    const isHigh = register === 'DDR'
      ? mode === 'OUTPUT'
      : register === 'PORT'
        ? level === 'HIGH'
        : mode === 'OUTPUT' ? level === 'HIGH' : level === 'HIGH'
    if (isHigh) value |= 1 << bit
  }
  return value.toString(2).padStart(8, '0')
}

export function RegisterViewer({ selectedPin, modes, levels, onSelectPin, onTogglePin }: RegisterViewerProps) {
  const registers = [
    { prefix: 'DDR' as const, fullName: `DDR${selectedPin.port}`, description: 'Data Direction Register', bits: registerValue('DDR', selectedPin.port, modes, levels) },
    { prefix: 'PORT' as const, fullName: `PORT${selectedPin.port}`, description: 'Port Output / Pull-up Register', bits: registerValue('PORT', selectedPin.port, modes, levels) },
    { prefix: 'PIN' as const, fullName: `PIN${selectedPin.port}`, description: 'Input Pins Register', bits: registerValue('PIN', selectedPin.port, modes, levels) },
  ]

  function handleBitClick(pin: PinDefinition | undefined) {
    if (!pin) return
    if (pin.id !== selectedPin.id) onSelectPin(pin.id)
    else onTogglePin(pin.id)
  }

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div><span className="eyebrow">AVR MEMORY / REGISTER VIEWER</span><h1>Register viewer</h1><p>Inspect live simulated register bits for the selected port.</p></div>
        <div className="register-target"><Binary size={18} /><span>{selectedPin.mcuPin}</span><small>BIT {selectedPin.bit}</small></div>
      </div>
      <section className="panel register-panel">
        <div className="panel-heading register-panel-heading"><div><span className="eyebrow">ATMEGA328P / PORT {selectedPin.port}</span><h2>8-bit register bank</h2></div><span className="simulation-tag"><span /> SIMULATED VALUES</span></div>
        <div className="register-explainer"><span className="register-explainer-bit">{selectedPin.bit}</span><span><strong>{selectedPin.id}</strong> maps to <strong>{selectedPin.mcuPin}</strong>, bit {selectedPin.bit} of Port {selectedPin.port}. Values update with the pin simulation.</span></div>
        <div className="register-list">{registers.map((register) => <div className="register-row" key={register.fullName}>
          <div className="register-meta"><strong>{register.fullName}</strong><span>{register.description}</span></div>
          <div className="register-bits" role="group" aria-label={`${register.fullName} bits 7 through 0`}>
            {register.bits.split('').map((value, index) => {
              const bit = 7 - index
              const mappedPin = pinForPortBit(selectedPin.port, bit)
              const isSelected = selectedPin.bit === bit
              return <button type="button" key={bit} className={`register-bit ${value === '1' ? 'set' : ''} ${isSelected ? 'selected' : ''}`} disabled={!mappedPin} title={mappedPin ? `${register.fullName} bit ${bit}: ${mappedPin.id}${mappedPin.id === selectedPin.id ? ' · click to toggle state' : ' · click to select pin'}` : `Bit ${bit} has no Arduino pin mapping`} aria-label={`${register.fullName} bit ${bit}, value ${value}${mappedPin ? `, ${mappedPin.id}` : ', unavailable'}`} onClick={() => handleBitClick(mappedPin)}>
                <span className="bit-number">{bit}</span><span className="bit-value">{value}</span>
              </button>
            })}
          </div>
        </div>)}</div>
        <div className="register-footer"><span><MousePointer2 size={14} /> Select another mapped bit, then click its selected bit to toggle the simulation.</span><span>MSB <i /> LSB</span></div>
      </section>
    </div>
  )
}