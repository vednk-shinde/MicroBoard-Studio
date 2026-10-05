import type { Detection } from '../ml/detector'

type DetectionOverlayProps = {
  detections: Detection[]
  video: HTMLVideoElement | null
}

function toPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value * 100))}%`
}

export function DetectionOverlay({ detections, video }: DetectionOverlayProps) {
  if (!detections.length) return null

  const displayWidth = video?.clientWidth ?? 0
  const displayHeight = video?.clientHeight ?? 0
  const sourceWidth = video?.videoWidth ?? 0
  const sourceHeight = video?.videoHeight ?? 0
  const scale = displayWidth > 0 && displayHeight > 0 && sourceWidth > 0 && sourceHeight > 0
    ? Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight)
    : 1
  const renderedWidth = sourceWidth * scale
  const renderedHeight = sourceHeight * scale
  const cropX = Math.max(0, (renderedWidth - displayWidth) / 2)
  const cropY = Math.max(0, (renderedHeight - displayHeight) / 2)

  return (
    <div className="detection-overlay" aria-live="polite">
      {detections.map((detection) => (
        (() => {
          const left = detection.bbox.x * renderedWidth - cropX
          const top = detection.bbox.y * renderedHeight - cropY
          const width = detection.bbox.width * renderedWidth
          const height = detection.bbox.height * renderedHeight
          return (
        <div
          key={detection.id}
          className="detection-box"
          style={{
            left: toPercent(displayWidth ? left / displayWidth : detection.bbox.x),
            top: toPercent(displayHeight ? top / displayHeight : detection.bbox.y),
            width: toPercent(displayWidth ? width / displayWidth : detection.bbox.width),
            height: toPercent(displayHeight ? height / displayHeight : detection.bbox.height),
          }}
          aria-label={`${detection.label} detected with ${Math.round(detection.confidence * 100)} percent confidence`}
        >
          <div className="detection-label">
            <span>{detection.label.replaceAll('_', ' ')}</span>
            <strong>{Math.round(detection.confidence * 100)}%</strong>
          </div>
        </div>
          )
        })()
      ))}
    </div>
  )
}
