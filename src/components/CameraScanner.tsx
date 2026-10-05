import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ShieldAlert, ScanLine, Square } from 'lucide-react'
import { DetectionOverlay } from './DetectionOverlay'
import { DetectedComponent } from './DetectedComponent'
import { ComponentWorkspace } from './ComponentWorkspace'
import type { InventoryPart } from '../sim/componentDetection'
import type { ComponentDetector, Detection } from '../ml/detector'
import { OnnxDetector } from '../ml/onnxDetector'

type CameraStatus = 'DISCONNECTED' | 'ACTIVE' | 'ERROR'
type AiModelStatus = 'NOT LOADED' | 'LOADING' | 'READY' | 'ERROR'
const INFERENCE_INTERVAL_MS = 1000

function scoreDetection(detections: Detection[]): Detection | null {
  if (!detections.length) return null
  return [...detections].sort((a, b) => b.confidence - a.confidence)[0]
}

export function CameraScanner({ onOpenCodeVisualizer, onInventoryChange }: { onOpenCodeVisualizer: (code: string) => void; onInventoryChange?: (parts: InventoryPart[]) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<ComponentDetector | null>(null)
  const timerRef = useRef<number | null>(null)
  const detectingRef = useRef(false)
  const operationRef = useRef(0)

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('DISCONNECTED')
  const [aiModelStatus, setAiModelStatus] = useState<AiModelStatus>('NOT LOADED')
  const [detections, setDetections] = useState<Detection[]>([])
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null)
  const [error, setError] = useState('')
  const [isStarting, setIsStarting] = useState(false)

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
    setDetections([])
    setSelectedDetection(null)
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
      if (detectingRef.current) {
        timerRef.current = window.setTimeout(() => void runInference(), 250)
        return
      }

      detectingRef.current = true

      try {
        const nextDetections = await detector.detect(video)
        if (operation === operationRef.current) {
          setDetections(nextDetections)
          setSelectedDetection(scoreDetection(nextDetections))
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
          timerRef.current = window.setTimeout(() => void runInference(), INFERENCE_INTERVAL_MS)
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
      await detector.load()
      if (operation !== operationRef.current) {
        detector.dispose()
        if (detectorRef.current === detector) detectorRef.current = null
        return
      }

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
          <p>Local camera inference for ESP8266 NodeMCU and other boards.</p>
        </div>
        <div className="camera-badge-group">
          <span className={`camera-status-badge ${cameraStatus === 'ACTIVE' ? 'camera-status-active' : cameraStatus === 'ERROR' ? 'camera-status-error' : 'camera-status-disconnected'}`}>
            <Camera size={13} /> CAMERA: {cameraStatus}
          </span>
          <span className="camera-status-badge camera-status-model">
            <ScanLine size={13} /> AI MODEL: YOLO11n ONNX · {aiModelStatus}
          </span>
          <span className="camera-status-badge camera-status-mode">DETECTION MODE: BOARD DETECTION</span>
        </div>
      </div>

      <section className="panel camera-panel">
        <div className="camera-toolbar">
          <div className="camera-header-labels">
            <span className="status-chip">CAMERA: {cameraStatus}</span>
            <span className="status-chip accent">AI MODEL: YOLO11n ONNX · {aiModelStatus}</span>
            <span className="status-chip">DETECTION MODE: BOARD DETECTION</span>
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
          <small>BOARD RESULTS: {detections.length} · DETECTED ≠ PHYSICALLY CONNECTED</small>
        </div>

        <DetectedComponent detection={selectedDetection} />
      </section>
      <ComponentWorkspace detections={detections} onOpenCodeVisualizer={onOpenCodeVisualizer} onInventoryChange={onInventoryChange} />
    </div>
  )
}
