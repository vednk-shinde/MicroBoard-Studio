import { useState } from 'react'
import { ArrowRight, Cpu, ShieldCheck } from 'lucide-react'
import { getBoardProfile } from '../data/boards'
import type { Detection } from '../ml/detector'

type DetectedComponentProps = {
  detection: Detection | null
}

export function DetectedComponent({ detection }: DetectedComponentProps) {
  const [profileOpen, setProfileOpen] = useState(false)

  if (!detection) {
    return (
      <section className="panel detection-card detection-card-empty" aria-live="polite">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DETECTED COMPONENT</span>
            <h2>Waiting for scan</h2>
          </div>
        </div>
        <p className="empty-state">No board detected in the current camera frame.</p>
      </section>
    )
  }

  const isEsp8266 = detection.classId === 0
  const boardProfile = isEsp8266 ? getBoardProfile('esp8266_nodemcu') : undefined
  const title = isEsp8266 ? 'ESP8266 NodeMCU detected' : 'Other board detected'

  return (
    <section className="panel detection-card" aria-live="polite">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DETECTED COMPONENT</span>
          <h2>{title}</h2>
        </div>
        <span className="model-badge"><ShieldCheck size={13} /> YOLO11n ONNX</span>
      </div>

      <div className="detected-component-grid">
        <div className="detected-stat">
          <span>Class</span>
          <strong>{detection.classId}: {detection.label.replaceAll('_', ' ')}</strong>
        </div>
        <div className="detected-stat">
          <span>Confidence</span>
          <strong>{Math.round(detection.confidence * 100)}%</strong>
        </div>
        <div className="detected-stat">
          <span>Model</span>
          <strong>YOLO11n ONNX</strong>
        </div>
      </div>

      {isEsp8266 && boardProfile && (
        <div className="detected-meta">
          <span><Cpu size={12} /> {boardProfile.mcu}</span>
          <span>{boardProfile.manufacturer}</span>
        </div>
      )}

      {isEsp8266 && boardProfile && (
        <>
          <button
            type="button"
            className="primary-button detection-open-button"
            onClick={() => setProfileOpen((open) => !open)}
            aria-expanded={profileOpen}
          >
            {profileOpen ? 'CLOSE ESP8266 BOARD PROFILE' : 'OPEN ESP8266 BOARD PROFILE'}
            <ArrowRight size={14} />
          </button>
          {profileOpen && (
            <div className="detected-meta" role="region" aria-label="ESP8266 NodeMCU board profile">
              <span><Cpu size={12} /> {boardProfile.name}</span>
              <span>MCU: {boardProfile.mcu}</span>
              <span>Manufacturer: {boardProfile.manufacturer}</span>
              <span>Profile: {boardProfile.pinProfile}</span>
            </div>
          )}
        </>
      )}
      {!isEsp8266 && <p className="empty-state">This class is not assigned to a specific board profile.</p>}
    </section>
  )
}
