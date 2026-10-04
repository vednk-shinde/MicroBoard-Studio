import { useState } from 'react'
import { AlertTriangle, ArrowRight, Check, Code2, Cpu, GitBranch } from 'lucide-react'
import { digitalPins } from '../data/pins'
import type { Detection } from '../ml/detector'
import { analyzeBoardDesign, suggestAlternativePins, type PinAssignments, type PinRole } from '../services/boardDesign'
import type { ResistorValues } from './ComponentInventory'
import './BoardDesigner.css'

export function BoardDesigner({ inventory, resistorValues, onAccept }: {
  inventory: Detection[]
  resistorValues: ResistorValues
  onAccept: (generatedCode: string) => void
}) {
  const [isCreated, setIsCreated] = useState(false)
  const [assignments, setAssignments] = useState<PinAssignments>({ led: 'D13', button: 'D2' })
  const [accepted, setAccepted] = useState(false)
  const analysis = analyzeBoardDesign(inventory, assignments, resistorValues)
  const hasUno = inventory.some((item) => item.confirmed && item.className === 'arduino_uno')
  const hasLed = inventory.some((item) => item.confirmed && item.className === 'led')
  const hasButton = inventory.some((item) => item.confirmed && item.className === 'push_button')

  function updateAssignment(role: PinRole, pinId: string) {
    setAssignments((current) => ({ ...current, [role]: pinId }))
    setAccepted(false)
  }

  return (
    <section className="panel board-designer-panel" aria-label="Board design assistant">
      <div className="panel-heading">
        <div><span className="eyebrow">LOGICAL CIRCUIT PLANNING</span><h2>Board Design</h2></div>
        <span className="board-designer-board"><Cpu size={13} /> UNO PIN MAP</span>
      </div>
      <p className="board-designer-intro">Build a suggested connection plan from user-confirmed parts. Camera detections alone never become a wiring instruction.</p>
      <button type="button" className="primary-button board-designer-create" onClick={() => { setIsCreated(true); setAccepted(false) }}>
        <GitBranch size={14} /> CREATE DESIGN
      </button>

      {isCreated && (
        <div className="board-design-workspace">
          {!hasUno && <p className="board-design-prerequisite">Confirm an Arduino Uno R3 in Build Inventory to enable the existing Uno pin map. The camera model does not identify Uno yet.</p>}

          <div className="board-design-summary">
            {inventory.filter((item) => item.confirmed).map((item) => <span key={item.id}>{item.className.replaceAll('_', ' ')}{item.className === 'resistor' && resistorValues[item.id] ? ` · ${resistorValues[item.id]} Ω` : ''}</span>)}
            {!inventory.some((item) => item.confirmed) && <span>No confirmed items selected.</span>}
          </div>

          {hasUno && (hasLed || hasButton) && (
            <div className="pin-assignment-grid">
              {hasLed && <PinAssignment role="led" label="LED output" pinId={assignments.led ?? 'D13'} assignments={assignments} onChange={updateAssignment} />}
              {hasButton && <PinAssignment role="button" label="Push button input" pinId={assignments.button ?? 'D2'} assignments={assignments} onChange={updateAssignment} />}
            </div>
          )}

          {analysis.conflicts.map((conflict) => (
            <div className="design-conflict" role="alert" key={conflict.pinId}>
              <AlertTriangle size={17} />
              <div><strong>PIN CONFLICT · {conflict.pinId}</strong><p>{conflict.pinId} is already assigned to {conflict.componentNames.join(' and ')}.</p>
                <small>Suggested alternatives: {conflict.componentNames.map((name) => {
                  const role = name === 'LED' ? 'led' : 'button'
                  const currentPin = assignments[role] ?? ''
                  const alternatives = suggestAlternativePins(role, currentPin, assignments).map((pin) => pin.id).join(', ')
                  return `${name}: ${alternatives || 'none available'}`
                }).join(' · ')}</small>
              </div>
            </div>
          ))}

          {analysis.suggestions.length > 0 && (
            <div className="suggested-connections">
              <div className="suggested-connections-heading"><span className="eyebrow">SUGGESTED CONNECTIONS</span><small>Review before wiring</small></div>
              {analysis.suggestions.map((connection) => <div className="suggested-connection" key={connection.id}><span>{connection.pinId}</span><ArrowRight size={13} /><p>{connection.text}</p></div>)}
              <CircuitDiagram inventory={inventory} assignments={assignments} resistorValues={resistorValues} hasLed={hasLed} hasButton={hasButton} />
            </div>
          )}

          <div className="design-warnings">
            <strong>ENGINEERING NOTES</strong>
            {analysis.warnings.map((warning) => <p key={warning}><AlertTriangle size={13} />{warning}</p>)}
            <p><AlertTriangle size={13} /> Motors must not be driven directly from GPIO. Servos may require a separate supply based on load.</p>
            <p><AlertTriangle size={13} /> GPIO current limits, supply requirements and resistor power ratings are not fully validated.</p>
          </div>

          {accepted && <div className="design-accepted"><Check size={15} /> Design accepted. Generated code is ready in Code Visualizer.</div>}
          <button type="button" className="primary-button board-designer-accept" disabled={!analysis.canAccept} onClick={() => { setAccepted(true); onAccept(analysis.generatedCode) }}>
            <Code2 size={14} /> ACCEPT DESIGN &amp; GENERATE CODE
          </button>
        </div>
      )}

      <p className="board-designer-footnote">Design suggestions are not a substitute for checking the board datasheet, wiring, component ratings, and power budget.</p>
    </section>
  )
}

function PinAssignment({ role, label, pinId, assignments, onChange }: {
  role: PinRole
  label: string
  pinId: string
  assignments: PinAssignments
  onChange: (role: PinRole, pinId: string) => void
}) {
  const otherRole = role === 'led' ? 'button' : 'led'
  const occupiedPin = assignments[otherRole]
  return (
    <label className="pin-assignment-field">{label}
      <select value={pinId} onChange={(event) => onChange(role, event.target.value)}>
        {digitalPins.map((pin) => <option value={pin.id} key={pin.id}>{pin.id} → {pin.mcuPin}{pin.peripherals.length ? ` · ${pin.peripherals.join('/')}` : ''}{pin.id === occupiedPin ? ' · CONFLICT' : ''}</option>)}
      </select>
      <small>Uno digital pin capability is read from the existing pin map.</small>
    </label>
  )
}

function CircuitDiagram({ inventory, assignments, resistorValues, hasLed, hasButton }: {
  inventory: Detection[]
  assignments: PinAssignments
  resistorValues: ResistorValues
  hasLed: boolean
  hasButton: boolean
}) {
  const resistor = inventory.find((item) => item.confirmed && item.className === 'resistor')
  const resistorValue = resistor ? resistorValues[resistor.id] : ''
  const ledPin = digitalPins.find((pin) => pin.id === assignments.led)
  const buttonPin = digitalPins.find((pin) => pin.id === assignments.button)

  return (
    <svg className="board-design-circuit" viewBox="0 0 760 240" role="img" aria-label="Suggested Uno circuit with assigned signal connections">
      <rect className="designer-board-block" x="12" y="36" width="134" height="168" rx="10" />
      <text className="designer-board-label" x="79" y="75" textAnchor="middle">ARDUINO</text>
      <text className="designer-board-model" x="79" y="96" textAnchor="middle">UNO R3</text>
      <text className="designer-board-mcu" x="79" y="120" textAnchor="middle">ATmega328P</text>
      <circle className="designer-board-port" cx="146" cy="83" r="5" />
      <circle className="designer-board-port" cx="146" cy="166" r="5" />
      {hasLed && <>
        <path className="designer-wire led-wire" d="M151 83H228" />
        <text className="designer-net-label" x="160" y="71">{assignments.led} / {ledPin?.mcuPin}</text>
        <path className="designer-resistor" d="M228 83L239 72L251 94L263 72L275 94L287 72L299 94L311 83H355" />
        <text className="designer-component-label" x="270" y="61" textAnchor="middle">{resistorValue ? `R · ${resistorValue} Ω` : 'R · VALUE REQUIRED'}</text>
        <path className="designer-wire led-wire" d="M355 83H402" />
        <path className="designer-led" d="M402 65V101L433 83Z" />
        <path className="designer-led-bar" d="M439 64V102" />
        <path className="designer-wire led-wire" d="M439 83H631V131" />
        <text className="designer-component-label" x="421" y="121" textAnchor="middle">LED</text>
        <path className="designer-ground" d="M612 131H650M619 139H643M626 147H636" />
        <text className="designer-ground-label" x="659" y="135">GND</text>
      </>}
      {hasButton && <>
        <path className="designer-wire button-wire" d="M151 166H337" />
        <text className="designer-net-label" x="161" y="154">{assignments.button} / {buttonPin?.mcuPin} · INPUT_PULLUP</text>
        <path className="designer-wire button-wire" d="M337 166H361M421 166H631V190" />
        <path className="designer-switch" d="M361 166L402 145" />
        <circle className="designer-switch-contact" cx="361" cy="166" r="4" />
        <circle className="designer-switch-contact" cx="421" cy="166" r="4" />
        <text className="designer-component-label" x="391" y="133" textAnchor="middle">PUSH BUTTON</text>
        <path className="designer-ground" d="M612 190H650M619 198H643M626 206H636" />
        <text className="designer-ground-label" x="659" y="194">GND</text>
      </>}
    </svg>
  )
}
