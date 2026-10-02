import { ArrowDown, ArrowRight, CircleHelp, Lightbulb, Radio, SlidersHorizontal } from 'lucide-react'
import { ArduinoBoard } from './ArduinoBoard'
import { getPin, type PinLevel, type PinMode, type PeripheralName } from '../data/pins'

interface PinExplorerProps {
  selectedPin: string
  onSelectPin: (pinId: string) => void
  mode: PinMode
  level: PinLevel
  physicalState: { mode: PinMode | null; level: PinLevel | null }
  isPhysicalConnected: boolean
  onModeChange: (mode: PinMode) => void
  onLevelChange: (level: PinLevel) => void
  onReadPhysical: () => void
  ledOn: boolean
  activePeripheral?: PeripheralName | null
}

export function PinExplorer({ selectedPin, onSelectPin, mode, level, physicalState, isPhysicalConnected, onModeChange, onLevelChange, onReadPhysical, ledOn, activePeripheral }: PinExplorerProps) {
  const pin = getPin(selectedPin)
  const registers = [`DDR${pin.port}`, `PORT${pin.port}`, `PIN${pin.port}`]
  const path = [pin.id, `ATmega328P ${pin.mcuPin}`, `Port ${pin.port}`, `Bit ${pin.bit}`, pin.functions[1] ?? pin.functions[0]]

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div><span className="eyebrow">SIGNAL PATH / PIN EXPLORER</span><h1>Trace the pin</h1><p>Follow an Arduino connection down to its AVR port bit.</p></div>
        <div className="pin-title-chip"><span>{pin.family.toUpperCase()} PIN</span><strong>{pin.id}</strong><small>{pin.mcuPin}</small></div>
      </div>
      <div className="explorer-grid">
        <ArduinoBoard selectedPin={selectedPin} onSelectPin={onSelectPin} ledOn={ledOn} activePeripheral={activePeripheral} />
        <section className="panel pin-detail-panel">
          <div className="panel-heading"><div><span className="eyebrow">SELECTED SIGNAL</span><h2>{pin.id} <span className="heading-muted">→</span> {pin.mcuPin}</h2></div><CircleHelp size={17} className="muted-icon" /></div>
          <div className="detail-summary"><span className="port-badge">PORT {pin.port}</span><span className="bit-badge">BIT {pin.bit}</span><span className="detail-family">{pin.family} pin</span></div>
          <div className="section-label">FUNCTIONS</div>
          <div className="function-list">{pin.functions.map((fn, index) => <span key={fn} className={index === 1 ? 'function-chip accent-chip' : 'function-chip'}>{fn}</span>)}</div>
          <div className="section-label register-label">REGISTERS <span>PORT {pin.port}</span></div>
          <div className="register-name-row">{registers.map((register) => <span key={register}>{register}</span>)}</div>
          <div className="path-flow" aria-label="Arduino pin signal path">
            {path.map((item, index) => <div className="path-step" key={`${item}-${index}`}><span className={index === 0 || index === path.length - 1 ? 'path-node active' : 'path-node'}>{item}</span>{index < path.length - 1 && <ArrowDown size={14} className="path-arrow" />}</div>)}
          </div>
          {pin.id === 'D13' && <div className={`led-status ${ledOn ? 'led-status-on' : ''}`}><Lightbulb size={15} /><span>Built-in LED</span><strong>{ledOn ? 'ON' : 'OFF'}</strong></div>}
          <div className="simulation-control">
              <div className="simulation-control-title"><SlidersHorizontal size={15} /><span>{isPhysicalConnected ? 'PIN CONTROL' : 'PIN SIMULATION'}</span><span className="simulation-tag small"><span /> {isPhysicalConnected ? 'USB + LOCAL' : 'LOCAL'}</span></div>
            <label className="mode-select-label" htmlFor="pin-mode">Mode</label>
            <select id="pin-mode" value={mode} onChange={(event) => onModeChange(event.target.value as PinMode)}>
              <option value="INPUT">INPUT</option><option value="INPUT_PULLUP">INPUT_PULLUP</option><option value="OUTPUT">OUTPUT</option>
            </select>
            <div className="state-toggle-row"><div><span className="state-title">Digital state</span><small>{isPhysicalConnected ? 'Updates simulation and sends a physical command' : 'Virtual register state only'}</small></div><button type="button" className={`state-toggle ${level === 'HIGH' ? 'is-high' : ''}`} disabled={mode === 'INPUT'} onClick={() => onLevelChange(level === 'HIGH' ? 'LOW' : 'HIGH')} aria-pressed={level === 'HIGH'}><span className="toggle-light" /> {level}</button></div>
            <div className="physical-readout">
              <div><span>Simulation</span><strong>{mode} / {level}</strong></div>
              <div><span>Physical · {pin.id}</span><strong>{isPhysicalConnected ? `${physicalState.mode ?? 'UNKNOWN'} / ${physicalState.level ?? 'UNKNOWN'}` : 'DISCONNECTED'}</strong></div>
            </div>
            {isPhysicalConnected && <button type="button" className="secondary-button" onClick={onReadPhysical}>READ physical pin</button>}
          </div>
          <div className="accuracy-note"><Radio size={13} /><span>{isPhysicalConnected ? 'Physical connection active. Simulation remains separate.' : 'Simulation only. No physical board is connected.'}</span><ArrowRight size={13} /></div>
        </section>
      </div>
    </div>
  )
}