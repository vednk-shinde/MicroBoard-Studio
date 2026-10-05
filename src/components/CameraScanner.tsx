import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ShieldAlert, ScanLine, Square } from 'lucide-react'
import { DetectionOverlay } from './DetectionOverlay'
import { DetectedComponent } from './DetectedComponent'
import { ComponentWorkspace } from './ComponentWorkspace'
import type { InventoryPart } from '../sim/componentDetection'
import type { ComponentDetector, Detection, DetectorInfo } from '../ml/detector'
import { DetectionTracker } from '../ml/detectionPolicy'
import { MODEL_META } from '../ml/modelMeta'
import { OnnxDetector } from '../ml/onnxDetector'

type CameraStatus = 'DISCONNECTED' | 'ACTIVE' | 'ERROR'
type AiModelStatus = 'NOT LOADED' | 'LOADING' | 'READY' | 'ERROR'
// Pause between inferences. The model itself takes ≈ 100 ms (WebGPU) to ≈ 650 ms (WebAssembly worker),
// so this gives ≈ 4 checks/s on WebGPU without keeping the GPU permanently busy.
const INFERENCE_GAP_MS = 150
const BACKEND_LABELS: Record<DetectorInfo['backend'], string> = { webgpu: 'WebGPU', 'wasm-worker': 'WASM worker', wasm: 'WASM' }

function primaryDetection(detections: Detection[]): Detection | null {
  const rank = (detection: Detection) => (detection.state === 'confirmed' ? 2 : detection.state === 'ambiguous' ? 1 : 0)
  return [...detections].sort((a, b) => rank(b) - rank(a) || b.confidence - a.confidence)[0] ?? null
}

export function CameraScanner({ onOpenCodeVisualizer, onInventoryChange }: { onOpenCodeVisualizer: (code: string) => void; onInventoryChange?: (parts: InventoryPart[]) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<ComponentDetector | null>(null)
  const timerRef = useRef<number | null>(null)
  const detectingRef = useRef(false)
  const operationRef = useRef(0)
  const trackerRef = useRef(new DetectionTracker(MODEL_META))

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('DISCONNECTED')
  const [aiModelStatus, setAiModelStatus] = useState<AiModelStatus>('NOT LOADED')
  const [detections, setDetections] = useState<Detection[]>([])
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null)
  const [error, setError] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [detectorInfo, setDetectorInfo] = useState<DetectorInfo | null>(null)
  const [inferenceMs, setInferenceMs] = useState<number | null>(null)

  const stopDetectionLoop = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const stopCamera = useCallback(() => {
    operationRef.current += 1
    stopDetectionLoop()

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }

    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }

    detectorRef.current?.dispose()
    detectorRef.current = null

    setIsStarting(false)
    trackerRef.current.reset()
    setDetections([])
    setSelectedDetection(null)
    setDetectorInfo(null)
    setInferenceMs(null)
    setAiModelStatus('NOT LOADED')
    setCameraStatus('DISCONNECTED')
    setError('')
  }, [stopDetectionLoop])

  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  const beginDetectionLoop = useCallback((operation: number) => {
    stopDetectionLoop()
    const runInference = async () => {
      timerRef.current = null
      if (operation !== operationRef.current) return

      const video = videoRef.current
      const detector = detectorRef.current

      if (!video || !detector || !streamRef.current) {
        return
      }
      if (detectingRef.current || document.hidden) {
        // Skip work while a frame is still processing or the tab isn't visible.
        timerRef.current = window.setTimeout(() => void runInference(), 250)
        return
      }

      detectingRef.current = true

      try {
        const started = performance.now()
        const candidates = await detector.detect(video)
        const elapsed = performance.now() - started
        if (operation === operationRef.current) {
          const tracked = trackerRef.current.update(candidates)
          setDetections(tracked)
          setSelectedDetection(primaryDetection(tracked))
          setInferenceMs((previous) => Math.round(previous === null ? elapsed : previous * 0.8 + elapsed * 0.2))
        }
      } catch (detectError) {
        if (operation !== operationRef.current) return
        const message = detectError instanceof Error ? detectError.message : 'Detector inference failed.'
        stopDetectionLoop()
        detector.dispose()
        detectorRef.current = null
        setAiModelStatus('ERROR')
        setError(message)
      } finally {
        detectingRef.current = false
        if (operation === operationRef.current && detectorRef.current === detector && streamRef.current) {
          timerRef.current = window.setTimeout(() => void runInference(), INFERENCE_GAP_MS)
        }
      }
    }
    void runInference()
  }, [stopDetectionLoop])

  const startCamera = useCallback(async () => {
    if (isStarting) return

    const operation = ++operationRef.current
    setIsStarting(true)
    setError('')
    setAiModelStatus('LOADING')
    let cameraReady = false

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported in this browser.')
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
      } catch (cameraError) {
        if (cameraError instanceof DOMException && cameraError.name !== 'OverconstrainedError') {
          throw cameraError
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })
      }

      if (operation !== operationRef.current) {
        for (const track of stream.getTracks()) track.stop()
        return
      }

      streamRef.current = stream
      const video = videoRef.current
      if (!video) {
        throw new Error('Camera element is unavailable.')
      }

      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await video.play()
      cameraReady = true
      setCameraStatus('ACTIVE')

      const detector: ComponentDetector = new OnnxDetector()
      detectorRef.current = detector
      const info = await detector.load()
      if (operation !== operationRef.current) {
        detector.dispose()
        if (detectorRef.current === detector) detectorRef.current = null
        return
      }

      setDetectorInfo(info)
      trackerRef.current.reset()
      setAiModelStatus('READY')
      beginDetectionLoop(operation)
    } catch (startError) {
      if (operation !== operationRef.current) return
      const cameraError = startError instanceof DOMException
      const message = cameraError && startError.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
        : cameraError && startError.name === 'NotFoundError'
          ? 'No camera was found. Connect a camera and try again.'
          : startError instanceof Error
            ? startError.message
            : 'Camera startup failed.'
      stopDetectionLoop()

      if (!cameraReady && streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop()
        }
        streamRef.current = null
      }

      const video = videoRef.current
      if (video) {
        video.pause()
        video.srcObject = null
      }

      detectorRef.current?.dispose()
      detectorRef.current = null

      setDetections([])
      setSelectedDetection(null)
      setCameraStatus(cameraReady ? 'ACTIVE' : 'ERROR')
      setAiModelStatus('ERROR')
      setError(message)
    } finally {
      if (operation === operationRef.current) setIsStarting(false)
    }
  }, [beginDetectionLoop, isStarting, stopDetectionLoop])

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">VISION / PATTERN RECOGNITION</span>
          <h1>Component scanner</h1>
          <p>Local camera inference with a {MODEL_META.classes.length}-class model ({MODEL_META.classes.map((item) => item.label).join(', ')}). Names are shown only when a part is recognised consistently.</p>
        </div>
        <div className="camera-badge-group">
          <span className={`camera-status-badge ${cameraStatus === 'ACTIVE' ? 'camera-status-active' : cameraStatus === 'ERROR' ? 'camera-status-error' : 'camera-status-disconnected'}`}>
            <Camera size={13} /> CAMERA: {cameraStatus}
          </span>
          <span className="camera-status-badge camera-status-model">
            <ScanLine size={13} /> AI MODEL: {MODEL_META.architecture.toUpperCase()} · {MODEL_META.name} · {aiModelStatus}
          </span>
          {detectorInfo && <span className="camera-status-badge camera-status-mode">{BACKEND_LABELS[detectorInfo.backend]}{inferenceMs !== null ? ` · ${inferenceMs} ms/frame` : ''}</span>}
        </div>
      </div>

      <section className="panel camera-panel">
        <div className="camera-toolbar">
          <div className="camera-header-labels">
            <span className="status-chip">CAMERA: {cameraStatus}</span>
            <span className="status-chip accent">AI MODEL: {MODEL_META.name} · {aiModelStatus}</span>
            {detectorInfo && <span className="status-chip">{BACKEND_LABELS[detectorInfo.backend]}{inferenceMs !== null ? ` · ${inferenceMs} ms` : ''}</span>}
          </div>
          <div className="camera-actions">
            <button type="button" className="primary-button" onClick={startCamera} disabled={cameraStatus === 'ACTIVE' || isStarting}>
              START CAMERA
            </button>
            <button type="button" className="secondary-button" onClick={stopCamera} disabled={cameraStatus !== 'ACTIVE'}>
              <Square size={12} /> STOP CAMERA
            </button>
          </div>
        </div>

        <div className="camera-surface" aria-label="Live camera scan surface">
          <video ref={videoRef} className="camera-video" playsInline muted aria-label="Camera preview for detecting boards" />

          {cameraStatus === 'ACTIVE' && <DetectionOverlay detections={detections} video={videoRef.current} />}

          {cameraStatus !== 'ACTIVE' && !error && (
            <div className="camera-placeholder">
              <Camera size={28} />
              <span>Camera disconnected</span>
            </div>
          )}

          {error && (
            <div className="camera-error-banner" role="alert">
              <ShieldAlert size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="camera-footer-row">
          <small>Camera frames are processed locally in your browser.</small>
          <small>RECOGNISED: {detections.filter((detection) => detection.state === 'confirmed').length} · SEEN ON CAMERA ≠ PHYSICALLY CONNECTED</small>
        </div>

        <DetectedComponent detection={selectedDetection} scanning={aiModelStatus === 'READY'} />
      </section>
      <ComponentWorkspace detections={detections} onOpenCodeVisualizer={onOpenCodeVisualizer} onInventoryChange={onInventoryChange} />
    </div>
  )
}
