// The deployed detection model: ONNX weights + metadata describing its classes and detection policy.
// To deploy a newly trained model, run ml/component_detection/export.py --deploy, which replaces both files.
import modelUrl from '../../ml/deploy/active/model.onnx?url'
import rawMeta from '../../ml/deploy/active/model_meta.json'

export type ModelClass = {
  id: number
  name: string
  label: string
  /** Minimum confidence to report this class. */
  threshold: number
  /** Class ID in the full MicroBoard taxonomy (data.yaml), when the model was trained on a subset. */
  sourceId?: number
  /** Never reached the target precision on the validation split: show the result with a warning. */
  unreliable?: boolean
}

export type DetectionPolicyConfig = {
  /** Candidates below this are ignored entirely. */
  candidateFloor: number
  defaultThreshold: number
  nmsIou: number
  /** Boxes smaller/larger than this fraction of the frame are rejected. */
  minBoxArea: number
  maxBoxArea: number
  /** A class is shown only after it passes its threshold in confirmHits of the last confirmWindow frames. */
  confirmWindow: number
  confirmHits: number
  /** Frames a track survives without a matching detection. */
  maxMisses: number
  /** If the runner-up class is within this confidence margin, the object is reported as ambiguous. */
  ambiguityMargin: number
}

export type ModelMeta = {
  name: string
  description: string
  architecture: string
  imageSize: number
  classes: ModelClass[]
  policy: DetectionPolicyConfig
  thresholdNote?: string
}

export const MODEL_URL: string = modelUrl
export const MODEL_META = rawMeta as ModelMeta

export function classThreshold(classId: number): number {
  return MODEL_META.classes[classId]?.threshold ?? MODEL_META.policy.defaultThreshold
}
