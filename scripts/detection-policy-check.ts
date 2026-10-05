// Checks the Camera Scanner's unknown-object policy against the deployed model metadata.
// Run: npx tsx scripts/detection-policy-check.ts
import { readFileSync } from 'node:fs'
import { DetectionTracker } from '../src/ml/detectionPolicy'
import type { Candidate, Detection } from '../src/ml/detector'
import type { ModelMeta } from '../src/ml/modelMeta'

const meta = JSON.parse(readFileSync(new URL('../ml/deploy/active/model_meta.json', import.meta.url), 'utf8')) as ModelMeta
const id = (name: string) => meta.classes.findIndex((item) => item.name === name)
const board = id('Microcontroller_Board')
const pot = id('Potentiometer')
const box = { x: 0.3, y: 0.3, width: 0.3, height: 0.3 }

function candidate(classId: number, confidence: number, extra: Partial<Candidate> = {}): Candidate {
  return { classId, className: meta.classes[classId].name, confidence, box, alternatives: [], ...extra }
}

function run(frames: Candidate[][]): Detection[] {
  const tracker = new DetectionTracker(meta)
  let result: Detection[] = []
  for (const frame of frames) result = tracker.update(frame)
  return result
}

let failures = 0
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures += 1
}

const boardThreshold = meta.classes[board].threshold
const confirmed = run([[candidate(board, 0.95)], [candidate(board, 0.94)]])
check('a confident part seen in 2 frames is confirmed', confirmed[0]?.state === 'confirmed' && confirmed[0].className === 'Microcontroller_Board')
check('one frame only stays tentative (no class shown)', run([[candidate(board, 0.95)]])[0]?.state === 'tentative')
check('below the class threshold never confirms', run([[candidate(board, boardThreshold - 0.05)], [candidate(board, boardThreshold - 0.05)], [candidate(board, boardThreshold - 0.05)]])[0]?.state === 'tentative')
check('nothing in view gives no detection (Unknown)', run([[], [], []]).length === 0)
check('a box filling the whole frame is rejected', run([[candidate(board, 0.95, { box: { x: 0, y: 0, width: 1, height: 1 } })], [candidate(board, 0.95, { box: { x: 0, y: 0, width: 1, height: 1 } })]]).length === 0)
check('a tiny speck is rejected', run([[candidate(board, 0.95, { box: { x: 0.5, y: 0.5, width: 0.02, height: 0.02 } })], [candidate(board, 0.95, { box: { x: 0.5, y: 0.5, width: 0.02, height: 0.02 } })]]).length === 0)
const close = [{ classId: pot, className: 'Potentiometer', confidence: 0.88 }]
check('two classes scoring close together are reported as ambiguous', run([[candidate(board, 0.95, { alternatives: close })], [candidate(board, 0.95, { alternatives: close })]])[0]?.state === 'ambiguous')
check('every class has a threshold of at least 0.5', meta.classes.every((item) => item.threshold >= 0.5))

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
