export type DetectionSource = 'camera' | 'manual'

export type NormalizedBox = {
  x: number
  y: number
  width: number
  height: number
}

/** One model prediction for one frame, before the detection policy decides whether to trust it. */
export type Candidate = {
  classId: number
  className: string
  confidence: number
  box: NormalizedBox
  /** Other classes the model scored for (almost) the same box, highest first. */
  alternatives: { classId: number; className: string; confidence: number }[]
}

/**
 * confirmed: passed its class threshold in enough recent frames.
 * tentative: seen, but not consistently enough yet; shown without a class name.
 * ambiguous: consistently seen, but two classes score too close to call.
 */
export type DetectionState = 'confirmed' | 'tentative' | 'ambiguous'

export type DetectedComponent = {
  id: string
  classId: number
  className: string
  label: string
  confidence: number
  boundingBox: NormalizedBox
  center: { x: number; y: number }
  source: DetectionSource
  confirmed: boolean
  /** Backward-compatible overlay field. */
  bbox: NormalizedBox
  state?: DetectionState
  /** For ambiguous detections: the competing class. */
  alternative?: { className: string; label: string; confidence: number }
}

export type Detection = DetectedComponent

export type DetectorInfo = {
  backend: 'webgpu' | 'wasm-worker' | 'wasm'
  loadMs: number
  warmupMs: number
}

export interface ComponentDetector {
  load(): Promise<DetectorInfo>
  detect(video: HTMLVideoElement): Promise<Candidate[]>
  dispose(): void
}
