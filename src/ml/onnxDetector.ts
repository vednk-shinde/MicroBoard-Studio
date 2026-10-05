import * as ort from 'onnxruntime-web/wasm'
import modelUrl from '../../ml/models/yolo11n_cpu_seed42_batch8-3/weights/best.onnx?url'
import type { ComponentDetector, Detection } from './detector'

const IMAGE_SIZE = 640
const CONFIDENCE_THRESHOLD = 0.4
const IOU_THRESHOLD = 0.45
const CLASS_NAMES = ['esp8266_nodemcu', 'other_board'] as const

type Letterbox = {
  scale: number
  padX: number
  padY: number
}

type Candidate = {
  classId: number
  confidence: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export class OnnxDetector implements ComponentDetector {
  private session: ort.InferenceSession | null = null
  private inputName = ''
  private outputName = ''
  private canvas: HTMLCanvasElement | null = null
  private context: CanvasRenderingContext2D | null = null

  async load(): Promise<void> {
    if (typeof WebAssembly === 'undefined' || typeof document === 'undefined') {
      throw new Error('This browser does not support WebAssembly required for ONNX inference.')
    }

    ort.env.wasm.numThreads = 1
    this.session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    this.inputName = this.session.inputNames[0] ?? ''
    this.outputName = this.session.outputNames[0] ?? ''
    if (!this.inputName || !this.outputName) {
      this.dispose()
      throw new Error('The ONNX model has no usable input or output tensors.')
    }

    this.canvas = document.createElement('canvas')
    this.canvas.width = IMAGE_SIZE
    this.canvas.height = IMAGE_SIZE
    this.context = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!this.context) {
      this.dispose()
      throw new Error('Could not initialize the camera frame processor.')
    }
  }

  async detect(video: HTMLVideoElement): Promise<Detection[]> {
    const session = this.session
    if (!session || !this.context || !this.canvas) {
      throw new Error('The YOLO11n ONNX model is not loaded.')
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return []
    }

    const letterbox = this.drawLetterboxedFrame(video)
    const input = this.createInputTensor()
    let outputs: Awaited<ReturnType<typeof session.run>> | undefined
    try {
      outputs = await session.run({ [this.inputName]: input })
      const output = outputs[this.outputName] as ort.Tensor | undefined
      if (!output) {
        throw new Error('The ONNX model did not return its detection output.')
      }
      return this.decodeOutput(output, video.videoWidth, video.videoHeight, letterbox)
    } finally {
      input.dispose()
      if (outputs) {
        for (const output of Object.values(outputs)) {
          output.dispose()
        }
      }
    }
  }

  dispose(): void {
    const session = this.session
    this.session = null
    if (session) {
      void session.release().catch(() => undefined)
    }
    this.canvas = null
    this.context = null
    this.inputName = ''
    this.outputName = ''
  }

  private drawLetterboxedFrame(video: HTMLVideoElement): Letterbox {
    const context = this.context
    if (!context) throw new Error('The camera frame processor is unavailable.')

    const scale = Math.min(IMAGE_SIZE / video.videoWidth, IMAGE_SIZE / video.videoHeight)
    const width = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)
    const padX = Math.round((IMAGE_SIZE - width) / 2)
    const padY = Math.round((IMAGE_SIZE - height) / 2)
    context.fillStyle = 'rgb(114, 114, 114)'
    context.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE)
    context.drawImage(video, padX, padY, width, height)
    return { scale, padX, padY }
  }

  private createInputTensor(): ort.Tensor {
    const context = this.context
    if (!context) throw new Error('The camera frame processor is unavailable.')

    const pixels = context.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE).data
    const planeSize = IMAGE_SIZE * IMAGE_SIZE
    const tensorData = new Float32Array(planeSize * 3)
    for (let pixel = 0; pixel < planeSize; pixel++) {
      const source = pixel * 4
      tensorData[pixel] = pixels[source] / 255
      tensorData[planeSize + pixel] = pixels[source + 1] / 255
      tensorData[planeSize * 2 + pixel] = pixels[source + 2] / 255
    }
    return new ort.Tensor('float32', tensorData, [1, 3, IMAGE_SIZE, IMAGE_SIZE])
  }

  private decodeOutput(
    output: ort.Tensor,
    sourceWidth: number,
    sourceHeight: number,
    letterbox: Letterbox,
  ): Detection[] {
    const dimensions = output.dims
    const data = output.data as Float32Array
    if (dimensions.length !== 3 || dimensions[0] !== 1) {
      throw new Error(`Unexpected YOLO output dimensions: ${dimensions.join('x')}`)
    }

    const channelFirst = dimensions[1] < dimensions[2]
    const featureCount = channelFirst ? dimensions[1] : dimensions[2]
    const candidateCount = channelFirst ? dimensions[2] : dimensions[1]
    if (featureCount !== CLASS_NAMES.length + 4) {
      throw new Error(`Expected ${CLASS_NAMES.length + 4} YOLO output values per box, received ${featureCount}.`)
    }
    const valueAt = (candidate: number, feature: number) => (
      data[channelFirst ? feature * candidateCount + candidate : candidate * featureCount + feature]
    )

    const candidates: Candidate[] = []
    for (let candidate = 0; candidate < candidateCount; candidate++) {
      const score0 = valueAt(candidate, 4)
      const score1 = valueAt(candidate, 5)
      const classId = score0 >= score1 ? 0 : 1
      const confidence = classId === 0 ? score0 : score1
      if (!Number.isFinite(confidence) || confidence < CONFIDENCE_THRESHOLD) continue

      const centerX = valueAt(candidate, 0)
      const centerY = valueAt(candidate, 1)
      const width = valueAt(candidate, 2)
      const height = valueAt(candidate, 3)
      if (![centerX, centerY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue
      candidates.push({
        classId,
        confidence,
        x1: centerX - width / 2,
        y1: centerY - height / 2,
        x2: centerX + width / 2,
        y2: centerY + height / 2,
      })
    }

    const selected: Candidate[] = []
    for (const candidate of candidates.sort((first, second) => second.confidence - first.confidence)) {
      if (selected.some((kept) => kept.classId === candidate.classId && this.intersectionOverUnion(kept, candidate) > IOU_THRESHOLD)) {
        continue
      }
      selected.push(candidate)
      if (selected.length >= 20) break
    }

    return selected.map((candidate) => {
      const x1 = this.clamp((candidate.x1 - letterbox.padX) / letterbox.scale / sourceWidth)
      const y1 = this.clamp((candidate.y1 - letterbox.padY) / letterbox.scale / sourceHeight)
      const x2 = this.clamp((candidate.x2 - letterbox.padX) / letterbox.scale / sourceWidth)
      const y2 = this.clamp((candidate.y2 - letterbox.padY) / letterbox.scale / sourceHeight)
      const boundingBox = { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) }
      const center = { x: x1 + boundingBox.width / 2, y: y1 + boundingBox.height / 2 }
      const className = CLASS_NAMES[candidate.classId]
      return {
        id: `camera-${candidate.classId}-${Math.round(center.x * 100)}-${Math.round(center.y * 100)}`,
        classId: candidate.classId,
        className,
        label: className,
        confidence: candidate.confidence,
        boundingBox,
        center,
        source: 'camera' as const,
        confirmed: false,
        bbox: boundingBox,
      }
    }).filter((detection) => detection.bbox.width > 0 && detection.bbox.height > 0)
  }

  private intersectionOverUnion(first: Candidate, second: Candidate): number {
    const width = Math.max(0, Math.min(first.x2, second.x2) - Math.max(first.x1, second.x1))
    const height = Math.max(0, Math.min(first.y2, second.y2) - Math.max(first.y1, second.y1))
    const intersection = width * height
    const firstArea = (first.x2 - first.x1) * (first.y2 - first.y1)
    const secondArea = (second.x2 - second.x1) * (second.y2 - second.y1)
    return intersection / Math.max(firstArea + secondArea - intersection, Number.EPSILON)
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value))
  }
}
