export type DetectionSource = 'camera' | 'manual'

export type NormalizedBox = {
  x: number
  y: number
  width: number
  height: number
}

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
}

export type Detection = DetectedComponent

export interface ComponentDetector {
  load(): Promise<void>
  detect(video: HTMLVideoElement): Promise<Detection[]>
  dispose(): void
}
