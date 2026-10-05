import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CircleHelp, CircleX, Hammer, RotateCcw, Terminal } from 'lucide-react'
import { type PinLevel, type PinMode } from '../data/pins'
import { compileAndRun, SIMULATOR_LIMITS, type CompileResult, type Diagnostic } from '../sim/arduinoSim'
import { ArduinoExecutionPath } from './ArduinoExecutionPath'
import './CodeVisualizer.css'

interface CodeVisualizerProps {
  initialCode?: string
  onSimulationChange: (pinId: string, mode: PinMode, level: PinLevel) => void
  onSelectPin: (pinId: string) => void
  reducedMotion: boolean
}

const examples = [
  {
    id: 'blink',
    label: 'Blink · built-in LED',
    code: `// Blink the built-in LED on D13
const int ledPin = LED_BUILTIN;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  digitalWrite(ledPin, HIGH);
  delay(1000);
  digitalWrite(ledPin, LOW);
  delay(1000);
}`,
  },
  {
    id: 'fade',
    label: 'Fade · PWM on D9',
    code: `// Fade an LED on D9 with PWM (Timer1)
int brightness = 0;
int fadeAmount = 85;

void setup() {
  pinMode(9, OUTPUT);
}

void loop() {
  analogWrite(9, brightness);
  brightness = brightness + fadeAmount;
  if (brightness <= 0 || brightness >= 255) {
    fadeAmount = -fadeAmount;
  }
  delay(30);
}`,
  },
  {
    id: 'button',
    label: 'Button · pull-up + Serial',
    code: `// Read a button on D2 (to GND) and mirror it on the LED
#define BUTTON_PIN 2
#define LED_PIN 13

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int pressed = digitalRead(BUTTON_PIN) == LOW;
  digitalWrite(LED_PIN, pressed ? HIGH : LOW);
  Serial.print("Button pressed: ");
  Serial.println(pressed);
  delay(200);
}`,
  },
  {
    id: 'sensor',
    label: 'Sensor · analogRead → PWM',
    code: `// Read a potentiometer on A0 and set LED brightness on D5
void setup() {
  Serial.begin(115200);
}

void loop() {
  int raw = analogRead(A0);
  int level = map(raw, 0, 1023, 0, 255);
  analogWrite(5, level);
  Serial.print("A0 = ");
  Serial.print(raw);
  Serial.print("  ->  PWM ");
  Serial.println(level);
  delay(100);
}`,
  },
  {
    id: 'chaser',
    label: 'LED chaser · arrays + for',
    code: `// Light LEDs on D2–D5 one after another
int leds[] = {2, 3, 4, 5};
const int count = sizeof(leds) / sizeof(leds[0]);

void setup() {
  for (int i = 0; i < count; i++) {
    pinMode(leds[i], OUTPUT);
  }
}

void loop() {
  for (int i = 0; i < count; i++) {
    digitalWrite(leds[i], HIGH);
    delay(150);
    digitalWrite(leds[i], LOW);
  }
}`,
  },
  {
    id: 'registers',
    label: 'Blink · direct registers',
    code: `// The same blink, writing the AVR registers directly
void setup() {
  DDRB |= (1 << PB5);    // PB5 (D13) as output
}

void loop() {
  PORTB |= (1 << PB5);   // D13 HIGH
  delay(500);
  PORTB &= ~(1 << PB5);  // D13 LOW
  delay(500);
}`,
  },
]

function offsetOfLine(code: string, line: number): [number, number] {
  const lines = code.split('\n')
  const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0)
  return [start, start + (lines[line - 1]?.length ?? 0)]
}

export function CodeVisualizer({ initialCode, onSimulationChange, onSelectPin, reducedMotion }: CodeVisualizerProps) {
  const startCode = initialCode ?? examples[0].code
  const [code, setCode] = useState(startCode)
  const [compiledCode, setCompiledCode] = useState(startCode)
  const [result, setResult] = useState<CompileResult>(() => compileAndRun(startCode))
  const [runKey, setRunKey] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLPreElement | null>(null)
  const traceRef = useRef<HTMLDivElement | null>(null)

  const run = result.ok ? result : null
  const dirty = code !== compiledCode
  const errorLines = useMemo(() => new Set(result.ok ? (result.runtimeError ? [result.runtimeError.line] : []) : result.errors.map((error) => error.line)), [result])
  const lineCount = code.split('\n').length

  function compile() {
    const next = compileAndRun(code)
    setResult(next)
    setCompiledCode(code)
    setRunKey((key) => key + 1)
    // On success, bring the animated execution path into view; on errors, stay with the messages in the editor.
    if (next.ok) requestAnimationFrame(() => traceRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }))
  }

  function loadExample(id: string) {
    const example = examples.find((candidate) => candidate.id === id)
    if (example) setCode(example.code)
  }

  function focusLine(line: number) {
    const textarea = textareaRef.current
    if (!textarea) return
    const [start, end] = offsetOfLine(code, line)
    textarea.focus()
    textarea.setSelectionRange(start, end)
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20
    textarea.scrollTop = Math.max(0, (line - 3) * lineHeight)
  }

  const diagnostics: { level: 'error' | 'warning'; item: Diagnostic }[] = result.ok
    ? [...(result.runtimeError ? [{ level: 'error' as const, item: result.runtimeError }] : []), ...result.warnings.map((item) => ({ level: 'warning' as const, item }))]
    : [...result.errors.map((item) => ({ level: 'error' as const, item })), ...result.warnings.map((item) => ({ level: 'warning' as const, item }))]

  const buildStatus = !result.ok ? `Compilation failed · ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}` : result.runtimeError ? 'Compiled · stopped by a runtime error' : 'Compiled and ran successfully'
  const emptyMessage = result.ok ? 'Press Compile & Run to simulate your sketch.' : 'Fix the compile errors in the sketch below to see its execution path.'

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div><span className="eyebrow">EXECUTION TRACE / CODE VISUALIZER</span><h1>Code → hardware</h1><p>Write any Arduino sketch, compile it, and watch it run on a simulated ATmega328P, down to the register bits.</p></div>
        <div className="simulation-tag large"><span /> SIMULATION</div>
      </div>
      <div ref={traceRef} className="code-visualizer-trace">
        <ArduinoExecutionPath key={runKey} run={run} source={compiledCode} autoplay={runKey > 0 && Boolean(run)} emptyMessage={emptyMessage} onSimulationChange={onSimulationChange} onSelectPin={onSelectPin} reducedMotion={reducedMotion} />
      </div>
      <div className="code-layout">
        <section className="panel code-editor-panel">
          <div className="panel-heading code-panel-heading"><div><span className="eyebrow">SKETCH INPUT</span><h2><Terminal size={17} /> Arduino sketch</h2></div><button type="button" className="icon-button" title="Restore the Blink example" aria-label="Restore the Blink example" onClick={() => setCode(examples[0].code)}><RotateCcw size={16} /></button></div>
          <div className="editor-toolbar">
            <span className="editor-language"><span /> C++ / ARDUINO</span>
            <label className="editor-example-picker">
              <span className="sr-only">Load an example sketch</span>
              <select value="" onChange={(event) => loadExample(event.target.value)}>
                <option value="" disabled>Load example…</option>
                {examples.map((example) => <option key={example.id} value={example.id}>{example.label}</option>)}
              </select>
            </label>
          </div>
          <div className="code-editor-shell">
            <pre className="code-editor-gutter" ref={gutterRef} aria-hidden="true">{Array.from({ length: lineCount }, (_, index) => <span key={index} className={errorLines.has(index + 1) && !dirty ? 'is-error' : ''}>{index + 1}</span>)}</pre>
            <label className="sr-only" htmlFor="sketch-code">Arduino code</label>
            <textarea
              id="sketch-code"
              ref={textareaRef}
              className="code-editor"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onScroll={(event) => { if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); compile() }
                if (event.key === 'Tab' && !event.shiftKey) {
                  event.preventDefault()
                  const target = event.currentTarget
                  const { selectionStart, selectionEnd } = target
                  setCode(`${code.slice(0, selectionStart)}  ${code.slice(selectionEnd)}`)
                  requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2))
                }
              }}
              spellCheck={false}
              wrap="off"
              aria-describedby="code-help"
            />
          </div>
          <div id="code-help" className="editor-help"><CircleHelp size={14} /><span>Supports <code>setup()</code>/<code>loop()</code>, variables, arrays, <code>if</code>/<code>for</code>/<code>while</code>/<code>switch</code>, functions, <code>#define</code>, digital &amp; analog I/O, PWM, <code>tone()</code>, <code>delay()</code>/<code>millis()</code>, <code>Serial</code> and direct <code>DDRx</code>/<code>PORTx</code>/<code>PINx</code> registers. Libraries aren't simulated.</span></div>
          {diagnostics.length > 0 && !dirty && (
            <ul className="compiler-diagnostics" aria-label="Compiler messages">
              {diagnostics.map(({ level, item }, index) => (
                <li key={`${level}-${item.line}-${index}`} className={`is-${level}`}>
                  <button type="button" onClick={() => focusLine(item.line)} title="Go to this line">
                    {level === 'error' ? <CircleX size={14} /> : <AlertTriangle size={14} />}
                    <span className="diagnostic-line">line {item.line}</span>
                    <span>{item.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="editor-actions">
            <button type="button" className="primary-button" onClick={compile}><Hammer size={15} /> Compile &amp; Run</button>
            <span className="editor-actions-caption">{dirty ? 'Code changed. Compile again to update.' : 'Ctrl + Enter · simulation only, no USB'}</span>
          </div>
        </section>
        <section className="panel flow-panel compiler-output-panel">
          <div className="panel-heading"><div><span className="eyebrow">COMPILER OUTPUT</span><h2>Build &amp; Serial Monitor</h2></div><span className={`flow-state build-state ${!result.ok || result.runtimeError ? 'is-error' : 'is-ok'}`}><span />{!result.ok ? 'FAILED' : result.runtimeError ? 'RUNTIME ERROR' : 'OK'}</span></div>
          <p className={`build-status ${!result.ok || result.runtimeError ? 'is-error' : ''}`}>{buildStatus}{dirty ? ' (for the previous version of the code)' : ''}</p>
          {run && (
            <div className="build-stats">
              <div><span>HARDWARE OPS</span><strong>{run.events.length}</strong></div>
              <div><span>LOOP() RUNS</span><strong>{run.loopIterations}</strong></div>
              <div><span>SIM TIME</span><strong>{run.final.timeMs >= 1000 ? `${(run.final.timeMs / 1000).toFixed(2)} s` : `${run.final.timeMs.toFixed(1)} ms`}</strong></div>
            </div>
          )}
          {run && <p className="build-note">{run.runtimeError ? `Line ${run.runtimeError.line}: ${run.runtimeError.message}` : run.stopReason} The simulator runs loop() up to {SIMULATOR_LIMITS.loopIterations} times and records at most {SIMULATOR_LIMITS.events} operations.</p>}
          <div className="serial-monitor">
            <div className="serial-monitor-heading"><span>SERIAL MONITOR</span><small>{run?.serial ? `${run.serial.length} bytes` : 'no output'}</small></div>
            <pre>{run?.serial || (run ? 'Nothing printed. Use Serial.begin() and Serial.println() to send text.' : 'Compile the sketch to see its serial output.')}</pre>
          </div>
        </section>
      </div>
    </div>
  )
}
