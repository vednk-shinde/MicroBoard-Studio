import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Check, Play, RotateCcw } from 'lucide-react'
import { getPinByArduinoNumber, type PinDefinition, type PinLevel, type PinMode } from '../data/pins'
import './ArduinoExecutionPath.css'

type ExecutionStepData = {
  title: string
  kind: string
  description: string
}

type ArduinoExecutionPathProps = {
  code: string
  onSimulationChange: (pinId: string, mode: PinMode, level: PinLevel) => void
  onSelectPin: (pinId: string) => void
  reducedMotion: boolean
}

type ExecutionPlan = {
  pin: PinDefinition
  pinNumber: number
  mode: PinMode
  level: PinLevel
  hasWrite: boolean
  sourceCode: string
  steps: ExecutionStepData[]
}

function createExecutionPlan(code: string): { plan: ExecutionPlan | null; error: string } {
  const modeMatch = code.match(/pinMode\s*\(\s*(\d+)\s*,\s*(OUTPUT|INPUT_PULLUP|INPUT)\s*\)/i)
  const writeMatch = code.match(/digitalWrite\s*\(\s*(\d+)\s*,\s*(HIGH|LOW)\s*\)/i)
  const pinNumber = Number(writeMatch?.[1] ?? modeMatch?.[1])
  const pin = getPinByArduinoNumber(pinNumber)

  if (!pin || (!modeMatch && !writeMatch)) {
    return { plan: null, error: 'Add a supported pinMode() or digitalWrite() command for digital pin 0–13.' }
  }
  if (modeMatch && writeMatch && modeMatch[1] !== writeMatch[1]) {
    return { plan: null, error: 'Use the same pin number in pinMode() and digitalWrite().' }
  }

  const mode = (modeMatch?.[2]?.toUpperCase() ?? 'OUTPUT') as PinMode
  if (writeMatch && mode !== 'OUTPUT') {
    return { plan: null, error: 'digitalWrite() requires pinMode(pin, OUTPUT).' }
  }
  const level = (writeMatch?.[2]?.toUpperCase() ?? 'LOW') as PinLevel
  const builtInLed = pin.id === 'D13'
  const outputDescription = writeMatch
    ? `${pin.mcuPin} now carries a ${level} digital signal.`
    : `The ${pin.mcuPin} output is configured and waiting for digitalWrite().`
  const physicalTitle = builtInLed
    ? `Built-in LED → ${level === 'HIGH' && writeMatch ? 'ON' : 'OFF'}`
    : `${pin.id} output → ${level}`

  const steps: ExecutionStepData[] = [
    { title: modeMatch ? `pinMode(${pinNumber}, ${mode})` : `digitalWrite(${pinNumber}, ${level})`, kind: 'CODE', description: `Configure Arduino Digital Pin ${pinNumber} as an ${mode}.` },
    { title: `Arduino ${pin.id}`, kind: 'PIN', description: `Digital pin ${pinNumber} is selected.` },
    { title: `ATmega328P · ${pin.mcuPin}`, kind: 'MCU', description: `Arduino ${pin.id} maps internally to ${pin.mcuPin} of the ATmega328P.` },
    { title: `DDR${pin.port} · bit ${pin.bit} → ${mode}`, kind: 'REGISTER', description: `DD${pin.port} bit ${pin.bit} is set to configure ${pin.mcuPin} as an ${mode.toLowerCase()}.` },
    { title: `PORT${pin.port} · bit ${pin.bit} → ${level}`, kind: 'REGISTER', description: writeMatch ? `PORT${pin.port} bit ${pin.bit} is set ${level}.` : `PORT${pin.port} remains ${level} until a digitalWrite() command runs.` },
    { title: `${pin.mcuPin} = ${level}`, kind: 'SIGNAL', description: outputDescription },
    { title: physicalTitle, kind: 'PHYSICAL', description: builtInLed
      ? `The Arduino Uno built-in LED connected to D13 turns ${level === 'HIGH' && writeMatch ? 'ON' : 'OFF'}.`
      : `${pin.id} drives the connected circuit ${level === 'HIGH' && writeMatch ? 'HIGH' : 'LOW'}.` },
  ]

  return { plan: { pin, pinNumber, mode, level, hasWrite: Boolean(writeMatch), sourceCode: code, steps }, error: '' }
}

function ExecutionStep({ step, index, activeStep, stepCount }: { step: ExecutionStepData; index: number; activeStep: number; stepCount: number }) {
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

function ArduinoPcb({ pinId, mcuPin, pinActive, ledOn }: { pinId: string; mcuPin: string; pinActive: boolean; ledOn: boolean }) {
  const digitalPins = Array.from({ length: 14 }, (_, index) => `D${index}`)
  const powerPins = ['IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN']
  const analogPins = Array.from({ length: 6 }, (_, index) => `A${index}`)
  const selectedPinNumber = Number(pinId.slice(1))
  const traceX = 133 + selectedPinNumber * 31.8

  return (
    <section className="panel execution-pcb-panel" aria-label="Arduino Uno R3 PCB visualization">
      <div className="panel-heading">
        <div><span className="eyebrow">VIRTUAL HARDWARE</span><h2>Arduino Uno R3</h2></div>
        <span className="simulation-tag"><span /> ATmega328P</span>
      </div>
      <svg className="execution-pcb-svg" viewBox="0 0 760 410" role="img" aria-label="Top-down Arduino Uno R3 circuit board with D13 connected to the ATmega328P PB5 pin">
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
          <circle cx="625" cy="235" r="4" />
          <circle cx="659" cy="235" r="4" />
          <text x="641" y="260" textAnchor="middle">TX · RX</text>
        </g>

        <g className="pcb-digital-header">
          <text x="119" y="48" className="pcb-header-label">DIGITAL · PWM ~</text>
          <rect className="pcb-header-base" x="116" y="55" width="451" height="48" rx="4" />
          {digitalPins.map((pin, index) => {
            const x = 133 + index * 31.8
            const highlighted = pin === pinId && pinActive
            return (
              <g className={`pcb-header-pin ${highlighted ? 'is-highlighted' : ''}`} key={pin}>
                <rect x={x - 10} y="61" width="20" height="20" rx="2" />
                <circle cx={x} cy="71" r="5" />
                <text x={x} y="96" textAnchor="middle">{pin}</text>
              </g>
            )
          })}
        </g>

        <g className="pcb-branding" aria-hidden="true">
          <text x="308" y="139" className="pcb-logo">∞</text>
          <text x="344" y="137" className="pcb-brand-name">ARDUINO</text>
          <text x="421" y="137" className="pcb-brand-version">UNO R3</text>
        </g>

        <path className={`pcb-signal-trace ${pinActive ? 'is-active' : ''}`} d={`M${traceX} 81V155H503V278H477`} />
        <text x="512" y="171" className={`pcb-signal-label ${pinActive ? 'is-active' : ''}`}>{pinId} → {mcuPin}</text>

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
          <text x="455" y="281" textAnchor="end" className="pcb-pin-function">{mcuPin}</text>
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
            return <g className="pcb-lower-pin" key={pin}><circle cx={x} cy="315" r="5" /><text x={x} y="333" textAnchor="middle">{pin}</text></g>
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

function CircuitDiagram({ pinId, mcuPin, outputOn, animate }: { pinId: string; mcuPin: string; outputOn: boolean; animate: boolean }) {
  return (
    <section className="panel circuit-panel" aria-label="Physical circuit diagram">
      <div className="panel-heading">
        <div><span className="eyebrow">OUTPUT STAGE</span><h2>Physical Circuit</h2></div>
        <span className={`circuit-status ${outputOn ? 'is-flowing' : ''}`}><i />{outputOn ? 'LED CURRENT FLOWING' : 'WAITING FOR HIGH SIGNAL'}</span>
      </div>
      <svg className={`circuit-schematic ${outputOn ? 'is-on' : ''}`} viewBox="0 0 720 190" role="img" aria-label={`Arduino ${pinId} connects through a 220 ohm resistor and LED to ground`}>
        <text className="schematic-caption" x="25" y="42">UNO R3 · {pinId} OUTPUT</text>
        <rect className="schematic-output" x="25" y="65" width="104" height="62" rx="5" />
        <text className="schematic-output-label" x="77" y="91" textAnchor="middle">{pinId}</text>
        <text className="schematic-output-sub" x="77" y="111" textAnchor="middle">{mcuPin}</text>
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
          {animate && <animateMotion dur="1.8s" repeatCount="indefinite" path="M129 96H185L285 96H336L385 96H571V137" />}
        </circle>
      </svg>
    </section>
  )
}

function CodePanel({ code, activeStep, plan }: { code: string; activeStep: number; plan: ExecutionPlan | null }) {
  const lines = code.split(/\r?\n/)
  const ledResult = plan?.pin.id === 'D13' && plan.level === 'HIGH' && plan.hasWrite

  return (
    <section className="panel execution-code-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">SOURCE CODE</span><h2>Arduino IDE</h2></div>
        <span className="execution-language">C++ / ARDUINO</span>
      </div>
      <pre className="execution-code"><code>{lines.map((line, index) => {
        const isModeLine = /pinMode\s*\(/i.test(line)
        const isWriteLine = /digitalWrite\s*\(/i.test(line)
        const highlighted = activeStep >= 0 && ((isModeLine && activeStep <= 3) || (isWriteLine && activeStep >= 4))
        return <span className={`execution-code-line ${highlighted ? 'is-highlighted' : ''}`} key={`${index}-${line}`}>{line || ' '}</span>
      })}</code></pre>
      <div className={`execution-code-result ${activeStep >= 6 && plan?.level === 'HIGH' ? 'is-on' : ''}`}><ArrowRight size={14} />{ledResult ? 'LED ON' : plan ? `${plan.pin.id} → ${plan.level}` : 'OUTPUT PENDING'}</div>
    </section>
  )
}

function RegisterView({ activeStep, plan }: { activeStep: number; plan: ExecutionPlan | null }) {
  const port = plan?.pin.port ?? 'B'
  const bitIndex = plan?.pin.bit ?? 5
  const mcuPin = plan?.pin.mcuPin ?? 'PB5'
  const portLevel = plan?.hasWrite && plan.level === 'HIGH' && activeStep >= 4

  return (
    <section className="panel execution-register-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">LOW-LEVEL VIEW</span><h2>ATmega328P Registers</h2></div>
        <span className="execution-register-value">{mcuPin} = {portLevel ? 'HIGH' : 'LOW'}</span>
      </div>
      <div className="register-rows">
        <div className={`execution-register-row ${activeStep >= 2 ? 'is-active' : ''}`}><strong>{mcuPin}</strong><span>Physical MCU pin</span></div>
        <div className={`execution-register-row ${activeStep >= 3 ? 'is-active' : ''}`}><strong>DDR{port}</strong><span>Data Direction Register</span></div>
        <div className={`execution-register-row ${activeStep >= 4 ? 'is-active' : ''}`}><strong>PORT{port}</strong><span>Output register</span></div>
      </div>
      <div className="register-bits" aria-label="Register bits seven through zero">
        {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => <span key={bit} className={bit === bitIndex && activeStep >= 3 ? 'is-active' : ''}><small>{bit}</small><strong>{bit === bitIndex && portLevel ? '1' : '0'}</strong></span>)}
      </div>
      <p className={`register-bit-caption ${activeStep >= 3 ? 'is-active' : ''}`}><i /> BIT {bitIndex} · {activeStep >= 3 ? 'ACTIVE' : 'WAITING'}</p>
    </section>
  )
}

export function ArduinoExecutionPath({ code, onSimulationChange, onSelectPin, reducedMotion }: ArduinoExecutionPathProps) {
  const [activeStep, setActiveStep] = useState(-1)
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [executedCode, setExecutedCode] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const timerRef = useRef<number | null>(null)
  const parsed = createExecutionPlan(code)
  const plan = parsed.plan
  const planIsCurrent = executedCode === code
  const visibleActiveStep = planIsCurrent ? activeStep : -1
  const visibleRunning = planIsCurrent && isRunning
  const visibleComplete = planIsCurrent && isComplete
  const stepCount = plan?.steps.length ?? 0
  const pinId = plan?.pin.id ?? 'D13'
  const mcuPin = plan?.pin.mcuPin ?? 'PB5'
  const ledOn = Boolean(plan?.pin.id === 'D13' && plan.hasWrite && plan.level === 'HIGH' && visibleActiveStep === stepCount - 1)
  const outputOn = Boolean(plan?.hasWrite && plan.level === 'HIGH' && visibleActiveStep === stepCount - 1)

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])
  useEffect(() => {
    if (timerRef.current !== null) clearTimer()
  }, [code])

  function resetExecution() {
    clearTimer()
    setActiveStep(-1)
    setIsRunning(false)
    setIsComplete(false)
    setExecutedCode('')
    setValidationMessage('')
    onSimulationChange(pinId, 'OUTPUT', 'LOW')
  }

  function runExecution() {
    clearTimer()
    const result = createExecutionPlan(code)
    if (!result.plan) {
      setActiveStep(-1)
      setIsRunning(false)
      setIsComplete(false)
      setExecutedCode(code)
      setValidationMessage(result.error)
      return
    }

    const executionPlan = result.plan
    setExecutedCode(code)
    setValidationMessage('')
    onSimulationChange(executionPlan.pin.id, executionPlan.mode, 'LOW')
    setActiveStep(0)
    setIsComplete(false)

    if (reducedMotion) {
      onSelectPin(executionPlan.pin.id)
      onSimulationChange(executionPlan.pin.id, executionPlan.mode, executionPlan.level)
      setActiveStep(executionPlan.steps.length - 1)
      setIsRunning(false)
      setIsComplete(true)
      return
    }

    setIsRunning(true)
    let nextStep = 1
    timerRef.current = window.setInterval(() => {
      setActiveStep(nextStep)
      if (nextStep === 1) onSelectPin(executionPlan.pin.id)
      if (nextStep === executionPlan.steps.length - 1) {
        clearTimer()
        setIsRunning(false)
        setIsComplete(true)
        onSimulationChange(executionPlan.pin.id, executionPlan.mode, executionPlan.level)
      }
      nextStep += 1
    }, 900)
  }

  return (
    <section className="arduino-execution-feature" aria-labelledby="execution-title">
      <header className="execution-feature-header">
        <div>
          <span className="eyebrow">LIVE EXECUTION PATH</span>
          <h2 id="execution-title">Software to Physical Pin</h2>
          <p>Visualize how Arduino code travels through the ATmega328P and reaches the physical LED.</p>
        </div>
        <div className="execution-controls">
          <span className={`execution-status ${!plan ? 'is-error' : visibleComplete ? 'is-complete' : visibleRunning ? 'is-running' : ''}`}><i />{!plan ? 'CHECK CODE' : visibleComplete ? 'COMPLETE' : visibleRunning ? 'RUNNING' : 'READY'}</span>
          <button type="button" className="primary-button" onClick={runExecution} disabled={!plan || visibleRunning}><Play size={14} fill="currentColor" /> RUN EXECUTION</button>
          <button type="button" className="secondary-button" onClick={resetExecution}><RotateCcw size={14} /> RESET</button>
        </div>
      </header>
      {(validationMessage || (!plan && code.trim())) && <p className="execution-validation-message" role="alert">{validationMessage || parsed.error}</p>}

      <div className="execution-main-grid">
        <section className="panel execution-path-panel" aria-label="Software execution steps">
          <div className="panel-heading"><div><span className="eyebrow">INSTRUCTION TRACE</span><h2>Software → silicon → light</h2></div><span className="execution-step-count">{String(stepCount).padStart(2, '0')} STEPS</span></div>
          <div className="execution-steps" aria-live="polite">
            {plan?.steps.map((step, index) => <ExecutionStep key={step.kind + step.title} step={step} index={index} activeStep={visibleActiveStep} stepCount={stepCount} />)}
            {!plan && <div className="execution-empty-state">Enter a matching pinMode() and digitalWrite() pair to build the live signal path.</div>}
          </div>
        </section>

        <div className="execution-hardware-column">
          <ArduinoPcb pinId={pinId} mcuPin={mcuPin} pinActive={visibleActiveStep >= 1} ledOn={ledOn} />
          <div className={`execution-signal-label ${visibleActiveStep >= 1 ? 'is-active' : ''}`}><span>{pinId}</span><i><ArrowRight size={14} /></i><strong>{mcuPin}</strong><small>ATmega328P</small></div>
          <CircuitDiagram pinId={pinId} mcuPin={mcuPin} outputOn={outputOn} animate={outputOn && !reducedMotion} />
        </div>
      </div>

      <div className="execution-detail-grid">
        <CodePanel code={code} activeStep={visibleActiveStep} plan={plan} />
        <RegisterView activeStep={visibleActiveStep} plan={plan} />
      </div>

      <aside className="execution-explanation">
        <span className="execution-explanation-icon">01</span>
        <div><span className="eyebrow">WHAT HAPPENS</span><h3>Code becomes electrical signal.</h3><p>{plan ? `pinMode() configures ${pinId} as an output. The Arduino maps ${pinId} to ${mcuPin} on the ATmega328P. When PORT${plan.pin.port} bit ${plan.pin.bit} becomes ${plan.level}, the ${pinId === 'D13' ? 'built-in LED' : 'connected circuit'} responds.` : 'Enter a supported Arduino digital pin command to see its path through the ATmega328P.'}</p></div>
        <strong className="execution-summary">CODE <i>→</i> MCU <i>→</i> {mcuPin} <i>→</i> {ledOn ? 'LED' : pinId}</strong>
      </aside>
      <p className="execution-simulation-note">SIMULATION ONLY · DETECTED ≠ PHYSICALLY CONNECTED · NO USB COMMANDS ARE SENT</p>
    </section>
  )
}