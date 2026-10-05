import * as ort from 'onnxruntime-web/webgpu'
import type { Candidate, ComponentDetector, DetectorInfo } from './detector'
import { MODEL_META, MODEL_URL } from './modelMeta'

const IMAGE_SIZE = MODEL_META.imageSize
const CLASS_COUNT = MODEL_META.classes.length
const MAX_RESULTS = 20
// Boxes of different classes overlapping this much are treated as one object with competing labels.
const SAME_OBJECT_IOU = 0.7
// Optional override for testing or for machines with a broken WebGPU driver.
const BACKEND_OVERRIDE_KEY = 'microboard.detector.backend'

type Letterbox = { scale: number; padX: number; padY: number }

type RawBox = {
  classId: number
  confidence: number
  x1: number
  y1: number
  x2: number
  y2: number
  scores: { classId: number; confidence: number }[]
}

type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }

function backendOverride(): DetectorInfo['backend'] | null {
  try {
    const value = localStorage.getItem(BACKEND_OVERRIDE_KEY)
    return value === 'webgpu' || value === 'wasm-worker' || value === 'wasm' ? value : null
  } catch {
    return null
  }
}

function iou(a: RawBox, b: RawBox): number {
  const width = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const height = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  const intersection = width * height
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - intersection
  return intersection / Math.max(union, Number.EPSILON)
}

export class OnnxDetector implements ComponentDetector {
  private session: ort.InferenceSession | null = null
  private inputName = ''
  private outputName = ''
  private canvas: HTMLCanvasElement | null = null
  private context: CanvasRenderingContext2D | null = null
  /** The inference currently running, so dispose() never frees the model underneath it. */
  private pending: Promise<unknown> | null = null

  async load(): Promise<DetectorInfo> {
    if (typeof WebAssembly === 'undefined' || typeof document === 'undefined') {
      throw new Error('This browser does not support WebAssembly required for ONNX inference.')
    }
    const started = performance.now()
    const forced = backendOverride()
    ort.env.wasm.numThreads = 1

    // Measured on the current model: WebGPU ≈ 100 ms/frame; WebAssembly ≈ 300 ms/frame on the main thread
    // (freezes the page) or ≈ 650 ms in a worker (no freezing). Prefer WebGPU, then the worker.
    let backend: DetectorInfo['backend'] | null = null
    const adapter = forced && forced !== 'webgpu' ? null : await (navigator as GpuNavigator).gpu?.requestAdapter().catch(() => null)
    if (adapter) {
      try {
        this.session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
        backend = 'webgpu'
      } catch {
        this.session = null
      }
    }
    if (!this.session) {
      // The worker proxy must be enabled before the WebAssembly runtime starts, so it's only possible
      // when WebGPU wasn't tried first.
      const useWorker = !adapter && forced !== 'wasm'
      ort.env.wasm.proxy = useWorker
      this.session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      backend = useWorker ? 'wasm-worker' : 'wasm'
    }
    const loadMs = performance.now() - started

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

    // Warm-up: the first run compiles GPU shaders / allocates buffers (≈ 2 s on WebGPU). Doing it here
    // keeps that pause out of the live scan.
    const warmupStarted = performance.now()
    const warmup = new ort.Tensor('float32', new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE).fill(114 / 255), [1, 3, IMAGE_SIZE, IMAGE_SIZE])
    const outputs = await this.session.run({ [this.inputName]: warmup })
    warmup.dispose()
    for (const output of Object.values(outputs)) output.dispose()
    return { backend: backend ?? 'wasm', loadMs: Math.round(loadMs), warmupMs: Math.round(performance.now() - warmupStarted) }
  }

  async detect(video: HTMLVideoElement): Promise<Candidate[]> {
    const session = this.session
    if (!session || !this.context || !this.canvas) throw new Error('The detection model is not loaded.')
    if (video.videoWidth === 0 || video.videoHeight === 0) return []

    const inputName = this.inputName
    const outputName = this.outputName
    const letterbox = this.drawLetterboxedFrame(video)
    const input = this.createInputTensor()
    let outputs: Awaited<ReturnType<typeof session.run>> | undefined
    try {
      const run = session.run({ [inputName]: input })
      this.pending = run
      outputs = await run
      const output = outputs[outputName] as ort.Tensor | undefined
      if (!output) throw new Error('The ONNX model did not return its detection output.')
      return this.decodeOutput(output, video.videoWidth, video.videoHeight, letterbox)
    } finally {
      this.pending = null
      input.dispose()
      if (outputs) for (const output of Object.values(outputs)) output.dispose()
    }
  }

  dispose(): void {
    const session = this.session
    this.session = null
    // Releasing while a run is in flight frees memory the run is still using; wait for it first.
    const pending = this.pending ?? Promise.resolve()
    if (session) void pending.catch(() => undefined).then(() => session.release()).catch(() => undefined)
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
    // A new buffer every frame: the worker backend takes ownership of the buffer it is given.
    const tensorData = new Float32Array(planeSize * 3)
    for (let pixel = 0; pixel < planeSize; pixel++) {
      const source = pixel * 4
      tensorData[pixel] = pixels[source] / 255
      tensorData[planeSize + pixel] = pixels[source + 1] / 255
      tensorData[planeSize * 2 + pixel] = pixels[source + 2] / 255
    }
    return new ort.Tensor('float32', tensorData, [1, 3, IMAGE_SIZE, IMAGE_SIZE])
  }

  private decodeOutput(output: ort.Tensor, sourceWidth: number, sourceHeight: number, letterbox: Letterbox): Candidate[] {
    const dimensions = output.dims
    const data = output.data as Float32Array
    if (dimensions.length !== 3 || dimensions[0] !== 1) throw new Error(`Unexpected YOLO output dimensions: ${dimensions.join('x')}`)
    // YOLO11 exports [1, 4 + classes, anchors]; also accept the transposed layout.
    const channelFirst = dimensions[1] === CLASS_COUNT + 4
    const featureCount = channelFirst ? dimensions[1] : dimensions[2]
    const anchorCount = channelFirst ? dimensions[2] : dimensions[1]
    if (featureCount !== CLASS_COUNT + 4) {
      throw new Error(`The model outputs ${featureCount - 4} classes but model_meta.json lists ${CLASS_COUNT}. Re-export the model or fix the metadata.`)
    }
    const valueAt = (anchor: number, feature: number) => data[channelFirst ? feature * anchorCount + anchor : anchor * featureCount + feature]
    const floor = MODEL_META.policy.candidateFloor

    const raw: RawBox[] = []
    for (let anchor = 0; anchor < anchorCount; anchor++) {
      const scores: { classId: number; confidence: number }[] = []
      for (let classId = 0; classId < CLASS_COUNT; classId++) {
        const confidence = valueAt(anchor, 4 + classId)
        if (Number.isFinite(confidence) && confidence >= floor) scores.push({ classId, confidence })
      }
      if (!scores.length) continue
      scores.sort((a, b) => b.confidence - a.confidence)
      const centerX = valueAt(anchor, 0)
      const centerY = valueAt(anchor, 1)
      const width = valueAt(anchor, 2)
      const height = valueAt(anchor, 3)
      if (![centerX, centerY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue
      raw.push({ classId: scores[0].classId, confidence: scores[0].confidence, scores: scores.slice(0, 3), x1: centerX - width / 2, y1: centerY - height / 2, x2: centerX + width / 2, y2: centerY + height / 2 })
    }

    // Class-aware non-maximum suppression.
    raw.sort((a, b) => b.confidence - a.confidence)
    const perClass: RawBox[] = []
    for (const box of raw) {
      if (perClass.some((kept) => kept.classId === box.classId && iou(kept, box) > MODEL_META.policy.nmsIou)) continue
      perClass.push(box)
    }
    // One physical object can get boxes from two similar classes; keep the strongest and record the other
    // as an alternative, so the policy can report the object as ambiguous instead of guessing.
    const merged: (RawBox & { alternatives: Map<number, number> })[] = []
    for (const box of perClass) {
      const owner = merged.find((kept) => kept.classId !== box.classId && iou(kept, box) > SAME_OBJECT_IOU)
      if (owner) {
        owner.alternatives.set(box.classId, Math.max(owner.alternatives.get(box.classId) ?? 0, box.confidence))
        continue
      }
      const alternatives = new Map<number, number>()
      for (const score of box.scores.slice(1)) alternatives.set(score.classId, score.confidence)
      merged.push({ ...box, alternatives })
      if (merged.length >= MAX_RESULTS) break
    }

    const toUnit = (value: number, pad: number, size: number) => Math.max(0, Math.min(1, (value - pad) / letterbox.scale / size))
    return merged.map((box) => {
      const x1 = toUnit(box.x1, letterbox.padX, sourceWidth)
      const y1 = toUnit(box.y1, letterbox.padY, sourceHeight)
      const x2 = toUnit(box.x2, letterbox.padX, sourceWidth)
      const y2 = toUnit(box.y2, letterbox.padY, sourceHeight)
      return {
        classId: box.classId,
        className: MODEL_META.classes[box.classId]?.name ?? `class_${box.classId}`,
        confidence: box.confidence,
        box: { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) },
        alternatives: [...box.alternatives.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([classId, confidence]) => ({ classId, className: MODEL_META.classes[classId]?.name ?? `class_${classId}`, confidence })),
      }
    }).filter((candidate) => candidate.box.width > 0 && candidate.box.height > 0)
  }
}
