import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Check, CircleHelp, Play, RotateCcw, Terminal } from 'lucide-react'
import { getPinByArduinoNumber, type PinLevel, type PinMode } from '../data/pins'
import { ArduinoExecutionPath } from './ArduinoExecutionPath'

interface CodeVisualizerProps {
  initialCode?: string
  onSimulationChange: (pinId: string, mode: PinMode, level: PinLevel) => void
  onSelectPin: (pinId: string) => void
  reducedMotion: boolean
}

const starterCode = 'pinMode(13, OUTPUT);\ndigitalWrite(13, HIGH);'

export function CodeVisualizer({ initialCode, onSimulationChange, onSelectPin, reducedMotion }: CodeVisualizerProps) {
  const [code, setCode] = useState(initialCode ?? starterCode)
  const [flow, setFlow] = useState<string[]>([])
  const [activeStep, setActiveStep] = useState(-1)
  const [message, setMessage] = useState('')
  const [running, setRunning] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => () => { if (timer.current !== null) window.clearInterval(timer.current) }, [])

  function visualize() {
    if (timer.current !== null) window.clearInterval(timer.current)
    const modeMatch = code.match(/pinMode\s*\(\s*(\d+)\s*,\s*(OUTPUT|INPUT_PULLUP|INPUT)\s*\)/i)
    const writeMatch = code.match(/digitalWrite\s*\(\s*(\d+)\s*,\s*(HIGH|LOW)\s*\)/i)
    const targetNumber = Number(writeMatch?.[1] ?? modeMatch?.[1])
    const pin = getPinByArduinoNumber(targetNumber)

    if (!pin || (!modeMatch && !writeMatch)) {
      setMessage('Add a supported pinMode() or digitalWrite() command for digital pin 0–13.')
      setFlow([])
      setActiveStep(-1)
      return
    }
    if (modeMatch && writeMatch && modeMatch[1] !== writeMatch[1]) {
      setMessage('Use the same Arduino pin number in pinMode() and digitalWrite().')
      setFlow([])
      setActiveStep(-1)
      return
    }

    const mode = (modeMatch?.[2]?.toUpperCase() ?? 'OUTPUT') as PinMode
    if (writeMatch && mode !== 'OUTPUT') {
      setMessage('digitalWrite() needs OUTPUT mode in this simulation. Change pinMode() to OUTPUT.')
      setFlow([])
      setActiveStep(-1)
      return
    }
    const level = (writeMatch?.[2]?.toUpperCase() ?? 'LOW') as PinLevel
    const stages = [
      modeMatch ? `pinMode(${targetNumber}, ${mode})` : `digitalWrite(${targetNumber}, ${level})`,
      `Arduino ${pin.id}`,
      `ATmega328P ${pin.mcuPin}`,
      `DDR${pin.port} · bit ${pin.bit} → ${mode}`,
      ...(writeMatch ? [`PORT${pin.port} · bit ${pin.bit} → ${level}`, `${pin.mcuPin} = ${level}`, `${pin.id} = ${level}`] : []),
      ...(pin.id === 'D13' && level === 'HIGH' && mode === 'OUTPUT' ? ['Built-in LED → ON'] : []),
    ]

    onSelectPin(pin.id)
    setMessage('')
    setFlow(stages)
    setActiveStep(reducedMotion ? stages.length - 1 : 0)
    setRunning(!reducedMotion)
    if (reducedMotion) {
      onSimulationChange(pin.id, mode, level)
      return
    }

    let nextStep = 1
    timer.current = window.setInterval(() => {
      if (nextStep >= stages.length) {
        if (timer.current !== null) window.clearInterval(timer.current)
        timer.current = null
        setRunning(false)
        onSimulationChange(pin.id, mode, level)
        return
      }
      setActiveStep(nextStep)
      nextStep += 1
    }, 460)
  }

  function reset() {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
    setRunning(false)
    setActiveStep(-1)
    setFlow([])
    setMessage('')
  }

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div><span className="eyebrow">EXECUTION TRACE / CODE VISUALIZER</span><h1>Code → hardware</h1><p>Step through supported Arduino calls and see their simulated register effects.</p></div>
        <div className="simulation-tag large"><span /> SIMULATION</div>
      </div>
      <ArduinoExecutionPath key={code} code={code} onSimulationChange={onSimulationChange} onSelectPin={onSelectPin} reducedMotion={reducedMotion} />
      <div className="code-layout">
        <section className="panel code-editor-panel">
          <div className="panel-heading code-panel-heading"><div><span className="eyebrow">SKETCH INPUT</span><h2><Terminal size={17} /> Arduino snippet</h2></div><button type="button" className="icon-button" title="Restore example code" aria-label="Restore example code" onClick={() => { setCode(starterCode); reset() }}><RotateCcw size={16} /></button></div>
          <div className="editor-toolbar"><span className="editor-language"><span /> C++ / ARDUINO</span><span>ATmega328P · Uno R3</span></div>
          <label className="sr-only" htmlFor="sketch-code">Arduino code</label>
          <textarea id="sketch-code" className="code-editor" value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} aria-describedby="code-help" />
          <div id="code-help" className="editor-help"><CircleHelp size={14} /><span>Supports <code>pinMode()</code> and <code>digitalWrite()</code> for D0–D13.</span></div>
          {message && <p className="inline-error" role="alert">{message}</p>}
          <div className="editor-actions"><button type="button" className="primary-button" onClick={visualize} disabled={running}><Play size={15} fill="currentColor" /> Visualize</button><span className="editor-actions-caption">Simulation only · no USB connection</span></div>
        </section>
        <section className="panel flow-panel">
          <div className="panel-heading"><div><span className="eyebrow">LIVE EXECUTION PATH</span><h2>Software to pin</h2></div><span className="flow-state"><span className={running ? 'pulse-dot' : ''} />{running ? 'RUNNING' : flow.length ? 'COMPLETE' : 'READY'}</span></div>
          {flow.length ? <div className="flow-stages">{flow.map((step, index) => <div key={`${step}-${index}`} className={`flow-stage ${index === activeStep ? 'active' : ''} ${index < activeStep ? 'passed' : ''}`}><span className="flow-stage-index">{index < activeStep ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span><span>{step}</span>{index < flow.length - 1 && <ArrowDown size={14} className="flow-stage-arrow" />}</div>)}</div> : <div className="flow-empty"><div className="empty-signal"><ArrowDown size={18} /></div><strong>Waiting for a sketch</strong><span>Run the example to animate its route through the MCU.</span></div>}
          <div className="flow-legend"><span><i className="legend-dot code" /> Code</span><span><i className="legend-dot mcu" /> MCU / register</span><span><i className="legend-dot output" /> Physical pin</span></div>
        </section>
      </div>
    </div>
  )
}