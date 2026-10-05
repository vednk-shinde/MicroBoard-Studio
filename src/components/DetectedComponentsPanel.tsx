import { MapPin, ScanLine } from 'lucide-react'
import { visionComponentInfo } from '../data/visionComponents'
import { MODEL_META } from '../ml/modelMeta'
import type { Detection } from '../ml/detector'

export function DetectedComponentsPanel({ detections, selectedId, onSelect }: {
  detections: Detection[]
  selectedId: string | null
  onSelect: (detection: Detection) => void
}) {
  return (
    <section className="panel component-detections-panel" aria-label="Camera detections">
      <div className="panel-heading">
        <div><span className="eyebrow">CAMERA RESULTS</span><h2>Detected Components</h2></div>
        <span className="status-chip accent"><ScanLine size={12} /> BOARD DETECTION</span>
      </div>
      <p className="detection-scope-note">The current model knows {MODEL_META.classes.length} classes: {MODEL_META.classes.map((item) => item.label).join(', ')}. Anything else stays unnamed. Only recognised parts can be added to the inventory.</p>
      {detections.length ? (
        <div className="detected-component-list" aria-live="polite">
          {detections.map((detection) => {
            const info = visionComponentInfo(detection.className)
            const title = detection.state === 'tentative' ? 'Unrecognised object (checking…)' : detection.state === 'ambiguous' && detection.alternative ? `${detection.label} or ${detection.alternative.label}?` : detection.label
            const box = detection.boundingBox
            return (
              <button
                type="button"
                key={detection.id}
                className={`detected-component-row ${selectedId === detection.id ? 'is-selected' : ''}`}
                onClick={() => onSelect(detection)}
                aria-pressed={selectedId === detection.id}
              >
                <span className="detected-component-icon"><ScanLine size={15} /></span>
                <span className="detected-component-main">
                  <strong>{title}</strong>
                  <small>{detection.state === 'confirmed' ? `${info.category ?? 'uncategorised'} · RECOGNISED` : detection.state === 'ambiguous' ? 'TOO CLOSE TO CALL' : 'NOT YET RECOGNISED'}</small>
                  <small className="detected-box-meta"><MapPin size={11} /> BOX {Math.round(box.x * 100)}%, {Math.round(box.y * 100)}% · {Math.round(box.width * 100)} × {Math.round(box.height * 100)}%</small>
                </span>
                <span className="detected-component-confidence">{detection.state === 'tentative' ? '—' : `${Math.round(detection.confidence * 100)}%`}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="component-detections-empty">
          <ScanLine size={18} />
          <span>Unknown / no supported component detected.</span>
        </div>
      )}
    </section>
  )
}
