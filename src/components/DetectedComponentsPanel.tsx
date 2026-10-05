import { MapPin, ScanLine } from 'lucide-react'
import { getComponentProfileByClassId } from '../data/componentCatalog'
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
      <p className="detection-scope-note">AI results are limited to the trained board classes. Individual components are not inferred by this model.</p>
      {detections.length ? (
        <div className="detected-component-list" aria-live="polite">
          {detections.map((detection) => {
            const profile = getComponentProfileByClassId(detection.classId)
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
                  <strong>{profile?.name ?? detection.className}</strong>
                  <small>{profile?.category ?? 'unknown'} · CAMERA</small>
                  <small className="detected-box-meta"><MapPin size={11} /> BOX {Math.round(box.x * 100)}%, {Math.round(box.y * 100)}% · {Math.round(box.width * 100)} × {Math.round(box.height * 100)}%</small>
                </span>
                <span className="detected-component-confidence">{Math.round(detection.confidence * 100)}%</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="component-detections-empty">
          <ScanLine size={18} />
          <span>{'No board objects detected in the latest frame.'}</span>
        </div>
      )}
    </section>
  )
}
