import { ArrowRight, BookOpen, Camera, ChevronRight, Code2, Cog, Cpu, LayoutGrid, Lightbulb, Monitor, Radar, ToggleLeft, Trash2, Usb, Zap, type LucideIcon } from 'lucide-react'
import { COMPONENT_LESSONS, type LessonCategory } from '../data/componentLessons'
import { getPin } from '../data/pins'
import { lessonKeyFor, type ComponentSource, type ProjectComponent } from '../sim/componentDetection'
import './LearnMode.css'

export type BasicLesson = { title: string; body: string; example: string }

type LearnModeProps = {
  basics: BasicLesson[]
  parts: ProjectComponent[]
  activeLesson: string
  onSelectLesson: (key: string) => void
  onOpenCodeVisualizer: () => void
  onOpenScanner: () => void
  onClearProject: () => void
}

const CATEGORY_ICONS: Record<LessonCategory, LucideIcon> = {
  Output: Lightbulb, Input: ToggleLeft, Sensor: Radar, Actuator: Cog, Passive: Zap, Display: Monitor, Communication: Usb, Board: Cpu, Prototyping: LayoutGrid,
}

const SOURCE_LABELS: Record<ComponentSource, string> = { code: 'FROM YOUR CODE', camera: 'CAMERA SCAN', manual: 'ADDED MANUALLY' }

function pinWithMcu(pinId: string): string {
  const pin = getPin(pinId)
  return pin.id === pinId ? `${pinId} (${pin.mcuPin})` : pinId
}

function ComponentLessonView({ part }: { part: ProjectComponent }) {
  const lesson = COMPONENT_LESSONS[part.id]
  const pinFor = (role: string, fallback: string) => {
    const assigned = part.pins.find((item) => item.role === role)?.pin ?? (role === 'SIGNAL' ? part.pins[0]?.pin : undefined)
    return pinWithMcu(assigned ?? fallback)
  }
  const path = lesson.path(pinFor)

  return (
    <>
      <div className="component-lesson-heading">
        <span className="eyebrow">YOUR PROJECT / {lesson.category.toUpperCase()}</span>
        <div className="component-lesson-sources">{part.sources.map((source) => <span key={source} className={`source-badge is-${source}`}>{SOURCE_LABELS[source]}</span>)}</div>
      </div>
      <h2>{lesson.name}</h2>
      <p className="component-lesson-summary">{lesson.summary}</p>
      {part.inferred && <p className="component-lesson-note">{part.inferred}</p>}

      <section className="component-lesson-section">
        <h3>How it works</h3>
        <p>{lesson.howItWorks}</p>
      </section>

      <div className="lesson-demo component-signal-path">
        <span className="eyebrow">SIGNAL PATH ON YOUR UNO</span>
        <ol className="signal-chain">
          {path.map((step, index) => <li key={step}><span>{step}</span>{index < path.length - 1 && <ArrowRight size={14} aria-hidden="true" />}</li>)}
        </ol>
        <span>{lesson.peripheral}</span>
      </div>

      <div className="component-lesson-grid">
        <section className="component-lesson-section">
          <h3>Wiring</h3>
          {part.pins.length > 0 && (
            <table className="component-pin-table">
              <caption>In your project</caption>
              <tbody>{part.pins.map((item) => <tr key={`${item.role}-${item.pin}`}><th>{item.role}</th><td>{pinWithMcu(item.pin)}</td></tr>)}</tbody>
            </table>
          )}
          <table className="component-pin-table">
            <caption>Component pins</caption>
            <tbody>{lesson.pinout.map((item) => <tr key={item.pin}><th>{item.pin}</th><td>{item.connectTo}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="component-lesson-section">
          <h3>Key facts</h3>
          <ul>{lesson.specs.map((spec) => <li key={spec}>{spec}</li>)}</ul>
          <h3>Tips</h3>
          <ul>{lesson.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
        </section>
      </div>

      {part.evidence.length > 0 && (
        <section className="component-lesson-section">
          <h3>Found in your sketch</h3>
          <ul className="component-evidence">{part.evidence.map((item) => <li key={item.line}><span>line {item.line}</span><code>{item.text}</code></li>)}</ul>
        </section>
      )}

      <section className="component-lesson-section">
        <h3>Example</h3>
        <pre className="component-code"><code>{lesson.code}</code></pre>
      </section>
    </>
  )
}

export function LearnMode({ basics, parts, activeLesson, onSelectLesson, onOpenCodeVisualizer, onOpenScanner, onClearProject }: LearnModeProps) {
  const keys = [...parts.map(lessonKeyFor), ...basics.map((_, index) => `basic-${index}`)]
  const currentKey = keys.includes(activeLesson) ? activeLesson : keys[0]
  const position = keys.indexOf(currentKey)
  const part = parts.find((candidate) => lessonKeyFor(candidate) === currentKey) ?? null
  const basicIndex = part ? -1 : Number(currentKey.slice('basic-'.length))
  const basic = basics[basicIndex]

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">GUIDED CONCEPTS / {parts.length ? 'YOUR PROJECT + AVR BASICS' : 'AVR BASICS'}</span>
          <h1>Learn the signal path</h1>
          <p>{parts.length ? `Lessons for the ${parts.length} component${parts.length === 1 ? '' : 's'} in your project, plus the ATmega328P basics.` : 'Short lessons grounded in the Uno R3 and ATmega328P.'}</p>
        </div>
        <BookOpen className="page-icon" size={22} />
      </div>
      <div className="learn-layout">
        <section className="panel lesson-list">
          <div className="panel-heading">
            <div><span className="eyebrow">YOUR PROJECT</span><h2>{parts.length ? `${parts.length} component${parts.length === 1 ? '' : 's'}` : 'No components yet'}</h2></div>
            {parts.length > 0 && <button type="button" className="icon-button" onClick={onClearProject} title="Clear project components" aria-label="Clear project components"><Trash2 size={15} /></button>}
          </div>
          {parts.length > 0 ? parts.map((item) => {
            const lesson = COMPONENT_LESSONS[item.id]
            const Icon = CATEGORY_ICONS[lesson.category]
            const key = lessonKeyFor(item)
            return (
              <button type="button" key={key} className={`lesson-item component-item ${currentKey === key ? 'active' : ''}`} onClick={() => onSelectLesson(key)}>
                <span><Icon size={15} /></span>
                <strong>{lesson.name}<small>{item.pins.length ? item.pins.map((pin) => pin.pin).filter((pin, index, all) => all.indexOf(pin) === index).join(' · ') : lesson.category}</small></strong>
                <ChevronRight size={14} />
              </button>
            )
          }) : (
            <div className="learn-empty">
              <p>Compile a sketch in the Code Visualizer, or confirm parts in the Camera Scanner. A lesson for every component in your project appears here.</p>
              <div>
                <button type="button" onClick={onOpenCodeVisualizer}><Code2 size={14} /> Code Visualizer</button>
                <button type="button" onClick={onOpenScanner}><Camera size={14} /> Camera Scanner</button>
              </div>
            </div>
          )}
          <div className="panel-heading lesson-list-divider"><div><span className="eyebrow">THE BASICS</span><h2>{basics.length} lessons</h2></div></div>
          {basics.map((item, index) => {
            const key = `basic-${index}`
            return <button type="button" key={item.title} className={`lesson-item ${currentKey === key ? 'active' : ''}`} onClick={() => onSelectLesson(key)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.title}</strong><ChevronRight size={14} /></button>
          })}
        </section>
        <article className="panel lesson-detail">
          {part ? <ComponentLessonView part={part} /> : basic && (
            <>
              <span className="eyebrow">LESSON {String(basicIndex + 1).padStart(2, '0')} / MICROCONTROLLER BASICS</span>
              <h2>{basic.title}</h2>
              <p>{basic.body}</p>
              <div className="lesson-demo"><span className="eyebrow">SIGNAL EXAMPLE</span><strong>{basic.example}</strong><span>ARDUINO UNO R3 · ATMEGA328P</span></div>
            </>
          )}
          <div className="lesson-pagination">
            <span>{position + 1} / {keys.length}</span>
            <button type="button" disabled={position >= keys.length - 1} onClick={() => onSelectLesson(keys[position + 1])}>Next lesson <ArrowRight size={14} /></button>
          </div>
        </article>
      </div>
    </div>
  )
}
