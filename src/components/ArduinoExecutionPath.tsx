import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Check, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { analogPins, digitalPins, getPin, type PinDefinition, type PinLevel, type PinMode } from '../data/pins'
import { pinModeIn, type SimEvent, type SimulationRun, type Snapshot, type TraceStep } from '../sim/arduinoSim'
import './ArduinoExecutionPath.css'

type ArduinoExecutionPathProps = {
  run: SimulationRun | null
  source: string
  autoplay: boolean
  emptyMessage: string
  onSimulationChange: (pinId: string, mode: PinMode, level: PinLevel) => void
  onSelectPin: (pinId: string) => void
  reducedMotion: boolean
}

type Position = { event: number; step: number }

const STEP_MS = 720
const SPEEDS = [1, 2, 4]

const EMPTY_SNAPSHOT: Snapshot = {
  regs: { DDRB: 0, PORTB: 0, PINB: 0, DDRC: 0, PORTC: 0, PINC: 0, DDRD: 0, PORTD: 0, PIND: 0 },
  pwm: {},
  tones: {},
  servos: {},
  timeMs: 0,
}

function bitOf(snapshot: Snapshot, register: string, bit: number): number {
  return ((snapshot.regs[register] ?? 0) >> bit) & 1
}

function hex(value: number): string {
  return `0x${(value & 0xff).toString(16).toUpperCase().padStart(2, '0')}`
}

function isDriving(snapshot: Snapshot, pin: PinDefinition): boolean {
  if (snapshot.pwm[pin.id] || snapshot.tones[pin.id] || snapshot.servos[pin.id] !== undefined) return true
  return bitOf(snapshot, `DDR${pin.port}`, pin.bit) === 1 && bitOf(snapshot, `PORT${pin.port}`, pin.bit) === 1
}

function ExecutionStep({ step, index, activeStep, stepCount }: { step: TraceStep; index: number; activeStep: number; stepCount: number }) {
  const complete = index < activeStep
  const active = index === activeStep

  return (
    <div className={`execution-step ${active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}`} aria-current={active ? 'step' : undefined}>
      <span className="execution-step-state">{complete ? <Check size={14} /> : String(index + 1).padStart(2, '0')}</span>
      <div className="execution-step-copy">
        <span className="execution-step-kind">{step.kind}</span>
        <strong>{step.title}</strong>
        <p>{step.description}</p>
      </div>
      <span className="execution-step-connector" aria-hidden="true"><i /></span>
      {index < stepCount - 1 && <ArrowDown className="execution-step-arrow" size={14} aria-hidden="true" />}
    </div>
  )
}

function ArduinoPcb({ focusPin, pinActive, snapshot, serialActive }: { focusPin: PinDefinition; pinActive: boolean; snapshot: Snapshot; serialActive: boolean }) {
  const powerPins = ['IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN']
  const isAnalog = focusPin.family === 'Analog'
  const traceX = isAnalog ? 472 + focusPin.bit * 31 : 133 + Number(focusPin.id.slice(1)) * 31.8
  const tracePath = isAnalog ? `M${traceX} 310V288H468V275` : `M${traceX} 81V155H503V278H477`
  const ledOn = isDriving(snapshot, getPin('D13'))

  return (
    <section className="panel execution-pcb-panel" aria-label="Arduino Uno R3 PCB visualization">
      <div className="panel-heading">
        <div><span className="eyebrow">VIRTUAL HARDWARE</span><h2>Arduino Uno R3</h2></div>
        <span className="simulation-tag"><span /> ATmega328P</span>
      </div>
      <svg className="execution-pcb-svg" viewBox="0 0 760 410" role="img" aria-label={`Top-down Arduino Uno R3 circuit board with ${focusPin.id} connected to the ATmega328P ${focusPin.mcuPin} pin`}>
        <defs>
          <linearGradient id="uno-solder-mask" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#277c59" />
            <stop offset="0.52" stopColor="#176344" />
            <stop offset="1" stopColor="#104b37" />
          </linearGradient>
          <linearGradient id="uno-usb-shell" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b9c5c4" />
            <stop offset="0.48" stopColor="#586a69" />
            <stop offset="1" stopColor="#293638" />
          </linearGradient>
        </defs>
        <path className="pcb-base" d="M75 27H704Q727 27 727 50V77H743V330H718V358H77Q51 358 51 332V57Q51 27 75 27Z" />
        <path className="pcb-edge" d="M78 35H698Q718 35 718 55V85H734V322H709V350H80Q60 350 60 330V58Q60 35 78 35Z" />

        <g className="pcb-mount-holes" aria-hidden="true">
          <circle cx="78" cy="58" r="10" /><circle cx="78" cy="58" r="5" />
          <circle cx="696" cy="58" r="10" /><circle cx="696" cy="58" r="5" />
          <circle cx="78" cy="329" r="10" /><circle cx="78" cy="329" r="5" />
          <circle cx="696" cy="329" r="10" /><circle cx="696" cy="329" r="5" />
        </g>

        <g className="pcb-traces" aria-hidden="true">
          <path d="M112 178H171V202H238M105 190H145V226H239M536 179H610V150H658M534 283H589V307H660M180 279H220V300H277" />
          <circle cx="171" cy="202" r="3" /><circle cx="145" cy="226" r="3" /><circle cx="610" cy="150" r="3" />
          <circle cx="589" cy="307" r="3" /><circle cx="220" cy="300" r="3" />
        </g>

        <g className="pcb-usb" aria-label="USB type B port">
          <path d="M18 90H99Q108 90 108 100V151Q108 161 98 161H18Q10 161 10 153V98Q10 90 18 90Z" />
          <rect x="25" y="103" width="71" height="43" rx="7" />
          <rect x="35" y="111" width="51" height="27" rx="4" />
          <text x="61" y="178" textAnchor="middle">USB-B</text>
        </g>

        <g className="pcb-power-jack" aria-label="DC power jack">
          <rect x="19" y="227" width="70" height="57" rx="8" />
          <circle cx="54" cy="255" r="17" />
          <circle cx="54" cy="255" r="7" />
          <text x="54" y="300" textAnchor="middle">DC IN</text>
        </g>

        <g className="pcb-small-parts" aria-hidden="true">
          <rect x="119" y="122" width="38" height="27" rx="4" />
          <circle cx="126" cy="135" r="3" /><circle cx="149" cy="135" r="3" />
          <text x="138" y="117" textAnchor="middle">RESET</text>
          <rect x="119" y="199" width="43" height="31" rx="4" />
          <path d="M127 199V230M138 199V230M149 199V230" />
          <text x="140" y="243" textAnchor="middle">NCP1117</text>
          <rect x="181" y="211" width="31" height="12" rx="5" />
          <text x="196" y="237" textAnchor="middle">16 MHz</text>
          <rect x="178" y="250" width="15" height="18" rx="4" />
          <rect x="201" y="250" width="15" height="18" rx="4" />
          <rect x="553" y="137" width="45" height="31" rx="4" />
          <path d="M560 137V168M571 137V168M582 137V168M593 137V168" />
          <text x="575" y="181" textAnchor="middle">ICSP</text>
          <rect x="610" y="226" width="31" height="19" rx="4" />
          <rect x="649" y="226" width="20" height="19" rx="4" />
          <circle className={`pcb-tx-led ${serialActive ? 'is-on' : ''}`} cx="625" cy="235" r="4" />
          <circle cx="659" cy="235" r="4" />
          <text x="641" y="260" textAnchor="middle">TX · RX</text>
        </g>

        <g className="pcb-digital-header">
          <text x="119" y="48" className="pcb-header-label">DIGITAL · PWM ~</text>
          <rect className="pcb-header-base" x="116" y="55" width="451" height="48" rx="4" />
          {digitalPins.map((pin, index) => {
            const x = 133 + index * 31.8
            const highlighted = pin.id === focusPin.id && pinActive
            return (
              <g className={`pcb-header-pin ${highlighted ? 'is-highlighted' : ''} ${isDriving(snapshot, pin) ? 'is-high' : ''}`} key={pin.id}>
                <rect x={x - 10} y="61" width="20" height="20" rx="2" />
                <circle cx={x} cy="71" r="5" />
                <text x={x} y="96" textAnchor="middle">{pin.id}</text>
              </g>
            )
          })}
        </g>

        <g className="pcb-branding" aria-hidden="true">
          <text x="308" y="139" className="pcb-logo">∞</text>
          <text x="344" y="137" className="pcb-brand-name">ARDUINO</text>
          <text x="421" y="137" className="pcb-brand-version">UNO R3</text>
        </g>

        <path className={`pcb-signal-trace ${pinActive ? 'is-active' : ''}`} d={tracePath} />
        <text x="512" y="171" className={`pcb-signal-label ${pinActive ? 'is-active' : ''}`}>{focusPin.id} → {focusPin.mcuPin}</text>

        <g className="pcb-main-mcu">
          <text x="365" y="174" textAnchor="middle" className="pcb-component-label">U1 · MICROCONTROLLER</text>
          <rect className="pcb-chip-body" x="255" y="195" width="220" height="72" rx="5" />
          {Array.from({ length: 14 }, (_, index) => {
            const x = 267 + index * 14.7
            return <g key={index}><rect className="pcb-chip-leg" x={x} y="187" width="8" height="8" /><rect className="pcb-chip-leg" x={x} y="267" width="8" height="8" /></g>
          })}
          <path className="pcb-chip-notch" d="M347 196A18 18 0 0 0 383 196" />
          <circle className="pcb-chip-pin-one" cx="271" cy="211" r="3" />
          <text x="365" y="229" textAnchor="middle" className="pcb-chip-name">ATMEGA328P-PU</text>
          <text x="365" y="247" textAnchor="middle" className="pcb-chip-caption">8-BIT AVR · 16 MHz</text>
          <text x="455" y="281" textAnchor="end" className="pcb-pin-function">{focusPin.mcuPin}</text>
        </g>

        <g className="pcb-lower-headers">
          <text x="230" y="294" className="pcb-header-label">POWER</text>
          <rect className="pcb-header-base" x="225" y="300" width="200" height="38" rx="4" />
          {powerPins.map((pin, index) => {
            const x = 240 + index * 28
            return <g className="pcb-lower-pin" key={`${pin}-${index}`}><circle cx={x} cy="315" r="5" /><text x={x} y="333" textAnchor="middle">{pin}</text></g>
          })}
          <text x="464" y="294" className="pcb-header-label">ANALOG IN</text>
          <rect className="pcb-header-base" x="456" y="300" width="191" height="38" rx="4" />
          {analogPins.map((pin, index) => {
            const x = 472 + index * 31
            const highlighted = pin.id === focusPin.id && pinActive
            return <g className={`pcb-lower-pin ${highlighted ? 'is-highlighted' : ''} ${isDriving(snapshot, pin) ? 'is-high' : ''}`} key={pin.id}><circle cx={x} cy="315" r="5" /><text x={x} y="333" textAnchor="middle">{pin.id}</text></g>
          })}
        </g>

        <g className={`pcb-led ${ledOn ? 'is-on' : ''}`} aria-label={ledOn ? 'Onboard LED L lit' : 'Onboard LED L off'}>
          <circle cx="618" cy="204" r="11" />
          <circle className="pcb-led-core" cx="618" cy="204" r="4" />
          <text x="637" y="208">L</text>
        </g>
        <text x="653" y="351" textAnchor="end" className="pcb-revision">UNO R3 · REV 3 · MADE IN ITALY</text>
      </svg>
    </section>
  )
}

function circuitState(pin: PinDefinition, snapshot: Snapshot): { mode: string; on: boolean; status: string } {
  const duty = snapshot.pwm[pin.id]
  const tone = snapshot.tones[pin.id]
  const servo = snapshot.servos[pin.id]
  const output = bitOf(snapshot, `DDR${pin.port}`, pin.bit) === 1
  const high = bitOf(snapshot, `PORT${pin.port}`, pin.bit) === 1
  if (servo !== undefined) return { mode: 'SERVO', on: true, status: `SERVO PULSES · ${servo}°` }
  if (tone) return { mode: 'TONE', on: true, status: `${tone} HZ SQUARE WAVE` }
  if (duty) return { mode: 'PWM', on: true, status: `PWM ${Math.round((duty / 255) * 100)}% · LED DIMMED` }
  if (output) return { mode: 'OUTPUT', on: high, status: high ? 'LED CURRENT FLOWING' : 'PIN LOW · NO CURRENT' }
  return { mode: high ? 'INPUT_PULLUP' : 'INPUT', on: false, status: high ? 'INPUT · PULLED HIGH' : 'INPUT · NOT DRIVING' }
}

function CircuitDiagram({ pin, snapshot, animate }: { pin: PinDefinition; snapshot: Snapshot; animate: boolean }) {
  const state = circuitState(pin, snapshot)
  return (
    <section className="panel circuit-panel" aria-label="Physical circuit diagram">
      <div className="panel-heading">
        <div><span className="eyebrow">OUTPUT STAGE</span><h2>Physical Circuit</h2></div>
        <span className={`circuit-status ${state.on ? 'is-flowing' : ''}`}><i />{state.status}</span>
      </div>
      <svg className={`circuit-schematic ${state.on ? 'is-on' : ''}`} viewBox="0 0 720 190" role="img" aria-label={`Arduino ${pin.id} connects through a 220 ohm resistor and LED to ground`}>
        <text className="schematic-caption" x="25" y="42">UNO R3 · {pin.id} {state.mode}</text>
        <rect className="schematic-output" x="25" y="65" width="104" height="62" rx="5" />
        <text className="schematic-output-label" x="77" y="91" textAnchor="middle">{pin.id}</text>
        <text className="schematic-output-sub" x="77" y="111" textAnchor="middle">{pin.mcuPin}</text>
        <path className="schematic-wire" d="M129 96H185M285 96H336M385 96H571V137" />
        <path className="schematic-resistor" d="M185 96L196 83L209 109L222 83L235 109L248 83L261 109L274 83L285 96" />
        <text className="schematic-component-label" x="235" y="68" textAnchor="middle">R1 · 220 Ω</text>
        <path className="schematic-diode" d="M336 74V118L374 96Z" />
        <path className="schematic-diode-bar" d="M380 72V120" />
        <path className="schematic-ray" d="M351 66L361 56M365 71L375 61" />
        <path className="schematic-ray" d="M351 126L361 136M365 121L375 131" />
        <text className="schematic-component-label" x="359" y="158" textAnchor="middle">D1 · LED</text>
        <path className="schematic-ground" d="M550 137H592M558 145H584M565 153H577" />
        <text className="schematic-ground-label" x="614" y="141">GND</text>
        <circle className="schematic-flow-dot" r="4">
          {animate && state.on && <animateMotion dur="1.8s" repeatCount="indefinite" path="M129 96H185L285 96H336L385 96H571V137" />}
        </circle>
      </svg>
    </section>
  )
}

function CodePanel({ source, event, active, resultOn }: { source: string; event: SimEvent | null; active: boolean; resultOn: boolean }) {
  const lines = source.split(/\r?\n/)
  return (
    <section className="panel execution-code-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">SOURCE CODE</span><h2>Arduino IDE</h2></div>
        <span className="execution-language">C++ / ARDUINO</span>
      </div>
      <pre className="execution-code"><code>{lines.map((line, index) => (
        <span className={`execution-code-line ${active && event?.line === index + 1 ? 'is-highlighted' : ''}`} key={`${index}-${line}`}>
          <i className="execution-code-number">{index + 1}</i>{line || ' '}
        </span>
      ))}</code></pre>
      <div className={`execution-code-result ${resultOn ? 'is-on' : ''}`}><ArrowRight size={14} />{event ? `LINE ${event.line} · ${event.result}` : 'COMPILE & RUN TO START'}</div>
    </section>
  )
}

function RegisterView({ pin, snapshot, step }: { pin: PinDefinition; snapshot: Snapshot; step: TraceStep | null }) {
  const port = pin.port
  const registers = [
    { name: `DDR${port}`, label: 'Data Direction Register' },
    { name: `PORT${port}`, label: 'Output / pull-up register' },
    { name: `PIN${port}`, label: 'Input register' },
  ]
  const activeRegister = step && (step.kind === 'REGISTER' || step.kind === 'TIMER') ? registers.find((register) => step.title.startsWith(register.name))?.name ?? null : null
  const state = circuitState(pin, snapshot)

  return (
    <section className="panel execution-register-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">LOW-LEVEL VIEW</span><h2>ATmega328P Registers</h2></div>
        <span className="execution-register-value">{pin.mcuPin} = {state.mode === 'PWM' || state.mode === 'TONE' || state.mode === 'SERVO' ? state.mode : bitOf(snapshot, `PIN${port}`, pin.bit) ? 'HIGH' : 'LOW'}</span>
      </div>
      <div className="register-rows">
        <div className={`execution-register-row ${step?.kind === 'MCU' ? 'is-active' : ''}`}><strong>{pin.mcuPin}</strong><span>Arduino {pin.id} · port {port}, bit {pin.bit}</span></div>
        {registers.map((register) => (
          <div key={register.name} className={`execution-register-row ${activeRegister === register.name ? 'is-active' : ''}`}>
            <strong>{register.name}</strong><span>{register.label} · {hex(snapshot.regs[register.name] ?? 0)}</span>
          </div>
        ))}
      </div>
      {registers.slice(0, 2).map((register) => (
        <div key={register.name}>
          <span className="register-bits-label">{register.name}</span>
          <div className="register-bits" aria-label={`${register.name} bits seven through zero`}>
            {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => <span key={bit} className={bit === pin.bit ? 'is-active' : ''}><small>{bit}</small><strong>{bitOf(snapshot, register.name, bit)}</strong></span>)}
          </div>
        </div>
      ))}
      <p className={`register-bit-caption ${activeRegister ? 'is-active' : ''}`}><i /> BIT {pin.bit} · {activeRegister ? `${activeRegister} UPDATING` : 'WATCHING'}</p>
    </section>
  )
}

export function ArduinoExecutionPath({ run, source, autoplay, emptyMessage, onSimulationChange, onSelectPin, reducedMotion }: ArduinoExecutionPathProps) {
  const events = run?.events ?? []
  const lastPosition = (): Position => ({ event: events.length - 1, step: (events.at(-1)?.steps.length ?? 1) - 1 })
  const [position, setPosition] = useState<Position>(() => (!events.length ? { event: -1, step: -1 } : autoplay && reducedMotion ? lastPosition() : { event: 0, step: autoplay ? 0 : -1 }))
  const [playing, setPlaying] = useState(autoplay && !reducedMotion && events.length > 0)
  const [speedIndex, setSpeedIndex] = useState(0)
  const timelineRef = useRef<HTMLDivElement | null>(null)

  const event = events[position.event] ?? null
  const lastStep = event ? event.steps.length - 1 : 0
  const complete = Boolean(event) && position.event === events.length - 1 && position.step >= lastStep
  const snapshot = !event ? run?.events[0]?.before ?? EMPTY_SNAPSHOT : position.step >= lastStep ? event.after : event.before
  const lastPinEvent = [...events.slice(0, position.event + 1)].reverse().find((candidate) => candidate.pin)
  const focusPin = event?.pin ?? lastPinEvent?.pin ?? events.find((candidate) => candidate.pin)?.pin ?? getPin('D13')
  const pinActive = Boolean(event?.pin) && position.step >= 1
  const currentStep = event && position.step >= 0 ? event.steps[position.step] : null
  const ledOn = isDriving(snapshot, getPin('D13'))

  useEffect(() => {
    if (!playing || !event) return
    const delay = (event.kind === 'delay' ? STEP_MS / 2 : STEP_MS) / SPEEDS[speedIndex]
    const timer = window.setTimeout(() => {
      if (position.step < lastStep) setPosition({ event: position.event, step: position.step + 1 })
      else if (position.event < events.length - 1) setPosition({ event: position.event + 1, step: 0 })
      else setPlaying(false)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [playing, position, event, lastStep, events.length, speedIndex])

  // The parent recreates these callbacks on every render; keep the latest in a ref so syncing
  // board state only happens when the trace position changes.
  const callbacks = useRef({ onSimulationChange, onSelectPin })
  useEffect(() => { callbacks.current = { onSimulationChange, onSelectPin } })

  useEffect(() => {
    if (!event?.pin) return
    if (position.step === 1) callbacks.current.onSelectPin(event.pin.id)
    if (position.step === lastStep) {
      const { mode, level } = pinModeIn(event.after, event.pin)
      callbacks.current.onSimulationChange(event.pin.id, mode, level)
    }
  }, [event, position.step, lastStep])

  useEffect(() => {
    const container = timelineRef.current
    const item = container?.querySelector<HTMLElement>('.execution-timeline-item.is-active')
    if (container && item) container.scrollTo({ left: item.offsetLeft - container.clientWidth / 2 + item.clientWidth / 2, behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [position.event, reducedMotion])

  function play() {
    if (!events.length) return
    if (complete || position.event < 0) setPosition({ event: 0, step: 0 })
    else if (position.step < 0) setPosition({ event: position.event, step: 0 })
    if (reducedMotion) { setPosition(lastPosition()); return }
    setPlaying(true)
  }

  function jumpTo(index: number) {
    if (index < 0 || index >= events.length) return
    setPlaying(false)
    setPosition({ event: index, step: events[index].steps.length - 1 })
  }

  function reset() {
    setPlaying(false)
    setPosition(events.length ? { event: 0, step: -1 } : { event: -1, step: -1 })
  }

  const status = !run ? 'CHECK CODE' : !events.length ? 'NO HARDWARE OPS' : playing ? 'RUNNING' : complete ? 'COMPLETE' : position.step >= 0 ? 'PAUSED' : 'READY'
  const statusClass = !run ? 'is-error' : playing ? 'is-running' : complete ? 'is-complete' : ''

  return (
    <section className="arduino-execution-feature" aria-labelledby="execution-title">
      <header className="execution-feature-header">
        <div>
          <span className="eyebrow">LIVE EXECUTION PATH</span>
          <h2 id="execution-title">Software to Physical Pin</h2>
          <p>Your sketch is compiled and run on a simulated ATmega328P. Step through every hardware operation it performs.</p>
        </div>
        <div className="execution-controls">
          <span className={`execution-status ${statusClass}`}><i />{status}</span>
          {playing
            ? <button type="button" className="primary-button" onClick={() => setPlaying(false)}><Pause size={14} fill="currentColor" /> PAUSE</button>
            : <button type="button" className="primary-button" onClick={play} disabled={!events.length}><Play size={14} fill="currentColor" /> {complete ? 'REPLAY' : position.step >= 0 ? 'RESUME' : 'RUN EXECUTION'}</button>}
          <button type="button" className="secondary-button icon-only" onClick={() => jumpTo(position.event - 1)} disabled={position.event <= 0} aria-label="Previous operation" title="Previous operation"><ChevronLeft size={15} /></button>
          <button type="button" className="secondary-button icon-only" onClick={() => jumpTo(Math.max(0, position.event + (position.step >= lastStep ? 1 : 0)))} disabled={!events.length || (position.event >= events.length - 1 && position.step >= lastStep)} aria-label="Next operation" title="Next operation"><ChevronRight size={15} /></button>
          <button type="button" className="secondary-button" onClick={() => setSpeedIndex((index) => (index + 1) % SPEEDS.length)} title="Playback speed">{SPEEDS[speedIndex]}×</button>
          <button type="button" className="secondary-button" onClick={reset}><RotateCcw size={14} /> RESET</button>
        </div>
      </header>

      {events.length > 0 && (
        <div className="execution-timeline-wrap">
          <div className="execution-timeline-meta"><span>HARDWARE OPERATIONS</span><strong>{position.event >= 0 ? position.event + 1 : 0} / {events.length}</strong></div>
          <div className="execution-timeline" ref={timelineRef}>
            {events.map((item, index) => (
              <button type="button" key={item.index} className={`execution-timeline-item ${index === position.event ? 'is-active' : ''} ${index < position.event ? 'is-done' : ''}`} onClick={() => jumpTo(index)} title={`Line ${item.line}: ${item.call}`}>
                <span>{item.phase === 'setup' ? 'SETUP' : `LOOP ${item.loopIteration}`} · L{item.line}</span>
                <strong>{item.call}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="execution-main-grid">
        <section className="panel execution-path-panel" aria-label="Software execution steps">
          <div className="panel-heading"><div><span className="eyebrow">INSTRUCTION TRACE</span><h2>Software → silicon → light</h2></div><span className="execution-step-count">{String(event?.steps.length ?? 0).padStart(2, '0')} STEPS</span></div>
          <div className="execution-steps" aria-live="polite">
            {event?.steps.map((step, index) => <ExecutionStep key={`${event.index}-${index}`} step={step} index={index} activeStep={position.step} stepCount={event.steps.length} />)}
            {!event && <div className="execution-empty-state">{run ? 'This sketch compiled but never touched the hardware. Add pinMode(), digitalWrite(), analogWrite(), Serial.print() or a register write.' : emptyMessage}</div>}
          </div>
        </section>

        <div className="execution-hardware-column">
          <ArduinoPcb focusPin={focusPin} pinActive={pinActive} snapshot={snapshot} serialActive={event?.kind === 'serial' && position.step >= 1} />
          <div className={`execution-signal-label ${pinActive ? 'is-active' : ''}`}><span>{focusPin.id}</span><i><ArrowRight size={14} /></i><strong>{focusPin.mcuPin}</strong><small>ATmega328P</small></div>
          <CircuitDiagram pin={focusPin} snapshot={snapshot} animate={!reducedMotion} />
        </div>
      </div>

      <div className="execution-detail-grid">
        <CodePanel source={source} event={event} active={position.step >= 0} resultOn={complete && ledOn} />
        <RegisterView pin={focusPin} snapshot={snapshot} step={currentStep} />
      </div>

      <aside className="execution-explanation">
        <span className="execution-explanation-icon">{String(Math.max(position.event + 1, 1)).padStart(2, '0')}</span>
        <div><span className="eyebrow">WHAT HAPPENS</span><h3>{event ? event.call : 'Code becomes electrical signal.'}</h3><p>{event ? event.explanation : run ? 'Press RUN EXECUTION to step through every hardware operation your sketch performs.' : emptyMessage}</p></div>
        <strong className="execution-summary">CODE <i>→</i> MCU <i>→</i> {focusPin.mcuPin} <i>→</i> {ledOn ? 'LED' : focusPin.id}</strong>
      </aside>
      <p className="execution-simulation-note">SIMULATION ONLY · NO SENSORS CONNECTED · NO USB COMMANDS ARE SENT</p>
    </section>
  )
}
