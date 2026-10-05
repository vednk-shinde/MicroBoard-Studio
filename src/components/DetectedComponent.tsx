import { useState, type ReactNode } from 'react'
import { ArrowRight, CircleHelp, Cpu, ScanSearch, ShieldCheck } from 'lucide-react'
import { getBoardProfile } from '../data/boards'
import { visionComponentInfo } from '../data/visionComponents'
import type { Detection } from '../ml/detector'
import { MODEL_META } from '../ml/modelMeta'

type DetectedComponentProps = {
  detection: Detection | null
  scanning: boolean
}

function StatusCard({ title, text, icon }: { title: string; text: string; icon: ReactNode }) {
  return (
    <section className="panel detection-card detection-card-empty" aria-live="polite">
      <div className="panel-heading">
        <div><span className="eyebrow">DETECTED COMPONENT</span><h2>{title}</h2></div>
        {icon}
      </div>
      <p className="empty-state">{text}</p>
    </section>
  )
}

export function DetectedComponent({ detection, scanning }: DetectedComponentProps) {
  const [profileOpen, setProfileOpen] = useState(false)

  if (!detection) {
    return scanning
      ? <StatusCard title="Unknown / no supported component detected" icon={<CircleHelp size={18} className="muted-icon" />}
          text={`Nothing in view matches the trained classes (${MODEL_META.classes.map((item) => item.label).join(', ')}) consistently enough to name it.`} />
      : <StatusCard title="Waiting for scan" icon={null} text="Start the camera to scan for components." />
  }
  if (detection.state === 'tentative') {
    return <StatusCard title="Checking…" icon={<ScanSearch size={18} className="muted-icon" />}
      text="Something is in view, but it hasn't been recognised consistently yet. Hold the part steady, in good light, filling a good part of the frame." />
  }
  if (detection.state === 'ambiguous' && detection.alternative) {
    return <StatusCard title={`Not sure: ${detection.label} or ${detection.alternative.label}?`} icon={<CircleHelp size={18} className="muted-icon" />}
      text={`The model scores both within a few points (${Math.round(detection.confidence * 100)}% vs ${Math.round(detection.alternative.confidence * 100)}%), so it won't pick one. Show the part's markings to the camera, or add it manually below.`} />
  }

  const info = visionComponentInfo(detection.className)
  const unreliable = MODEL_META.classes[detection.classId]?.unreliable === true
  const boardProfile = info.catalogProfileId === 'esp8266_nodemcu' ? getBoardProfile('esp8266_nodemcu') : undefined

  return (
    <section className="panel detection-card" aria-live="polite">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DETECTED COMPONENT</span>
          <h2>{detection.label}</h2>
        </div>
        <span className="model-badge"><ShieldCheck size={13} /> {MODEL_META.architecture.toUpperCase()} · {MODEL_META.name}</span>
      </div>

      <div className="detected-component-grid">
        <div className="detected-stat"><span>Class</span><strong>{detection.classId}: {detection.className}</strong></div>
        <div className="detected-stat"><span>Confidence</span><strong>{Math.round(detection.confidence * 100)}%</strong></div>
        <div className="detected-stat"><span>Category</span><strong>{info.category ?? '—'}</strong></div>
      </div>
      <p className="empty-state">
        {info.description ? `${info.description}. ` : 'This class has no entry in the component database yet. '}
        Recognised visually only: that doesn't mean it is wired up or working.
      </p>
      {unreliable && (
        <p className="empty-state detection-warning" role="note">
          This class is one of the model's weakest (it never reached 90% precision in testing), so treat this as a guess and check the part yourself.
        </p>
      )}

      {boardProfile && (
        <>
          <button type="button" className="primary-button detection-open-button" onClick={() => setProfileOpen((open) => !open)} aria-expanded={profileOpen}>
            {profileOpen ? 'CLOSE BOARD PROFILE' : 'OPEN BOARD PROFILE'}
            <ArrowRight size={14} />
          </button>
          {profileOpen && (
            <div className="detected-meta" role="region" aria-label={`${boardProfile.name} board profile`}>
              <span><Cpu size={12} /> {boardProfile.name}</span>
              <span>MCU: {boardProfile.mcu}</span>
              <span>Manufacturer: {boardProfile.manufacturer}</span>
              <span>Profile: {boardProfile.pinProfile}</span>
            </div>
          )}
        </>
      )}
    </section>
  )
}
