// Decides which model predictions to trust. A single frame's score is not enough: a phone, a hand or a
// bottle can briefly score above threshold. A class name is reported only when the same object passes
// its class threshold in several recent frames, is a plausible size, and isn't a near-tie with another class.
import type { Candidate, Detection, DetectionState, NormalizedBox } from './detector'
import type { ModelMeta } from './modelMeta'

type Observation = {
  classId: number
  confidence: number
  passed: boolean
  alternatives: Candidate['alternatives']
}

type Track = {
  id: number
  box: NormalizedBox
  /** Most recent last; null = the object wasn't matched in that frame. */
  history: (Observation | null)[]
  misses: number
}

const MATCH_IOU = 0.3

function iou(a: NormalizedBox, b: NormalizedBox): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const intersection = width * height
  return intersection / Math.max(a.width * a.height + b.width * b.height - intersection, Number.EPSILON)
}

export class DetectionTracker {
  private tracks: Track[] = []
  private nextId = 1
  private meta: Pick<ModelMeta, 'classes' | 'policy'>

  constructor(meta: Pick<ModelMeta, 'classes' | 'policy'>) {
    this.meta = meta
  }

  private threshold(classId: number): number {
    return this.meta.classes[classId]?.threshold ?? this.meta.policy.defaultThreshold
  }

  private labelFor(classId: number): string {
    return this.meta.classes[classId]?.label ?? this.meta.classes[classId]?.name ?? 'Unknown'
  }

  private nameFor(classId: number): string {
    return this.meta.classes[classId]?.name ?? `class_${classId}`
  }

  reset() {
    this.tracks = []
  }

  update(candidates: Candidate[]): Detection[] {
    const policy = this.meta.policy
    const usable = candidates.filter((candidate) => {
      const area = candidate.box.width * candidate.box.height
      return area >= policy.minBoxArea && area <= policy.maxBoxArea
    })

    // Greedy matching of this frame's candidates to existing tracks by box overlap.
    const pairs: { track: Track; candidate: Candidate; overlap: number }[] = []
    for (const track of this.tracks) {
      for (const candidate of usable) {
        const overlap = iou(track.box, candidate.box)
        if (overlap >= MATCH_IOU) pairs.push({ track, candidate, overlap })
      }
    }
    pairs.sort((a, b) => b.overlap - a.overlap)
    const matchedTracks = new Set<Track>()
    const matchedCandidates = new Set<Candidate>()
    for (const { track, candidate } of pairs) {
      if (matchedTracks.has(track) || matchedCandidates.has(candidate)) continue
      matchedTracks.add(track)
      matchedCandidates.add(candidate)
      track.box = {
        x: (track.box.x + candidate.box.x) / 2,
        y: (track.box.y + candidate.box.y) / 2,
        width: (track.box.width + candidate.box.width) / 2,
        height: (track.box.height + candidate.box.height) / 2,
      }
      track.history.push(this.observe(candidate))
      track.misses = 0
    }
    for (const track of this.tracks) {
      if (matchedTracks.has(track)) continue
      track.history.push(null)
      track.misses += 1
    }
    for (const candidate of usable) {
      if (matchedCandidates.has(candidate)) continue
      this.tracks.push({ id: this.nextId++, box: candidate.box, history: [this.observe(candidate)], misses: 0 })
    }
    for (const track of this.tracks) track.history = track.history.slice(-policy.confirmWindow)
    this.tracks = this.tracks.filter((track) => track.misses <= policy.maxMisses && track.history.some(Boolean))

    return this.tracks.map((track) => this.describe(track))
  }

  private observe(candidate: Candidate): Observation {
    return {
      classId: candidate.classId,
      confidence: candidate.confidence,
      passed: candidate.confidence >= this.threshold(candidate.classId),
      alternatives: candidate.alternatives,
    }
  }

  private describe(track: Track): Detection {
    const policy = this.meta.policy
    const seen = track.history.filter((entry): entry is Observation => entry !== null)
    const passing = seen.filter((entry) => entry.passed)

    // Vote for the class across recent frames, weighted by confidence.
    const votes = new Map<number, number>()
    for (const entry of passing) votes.set(entry.classId, (votes.get(entry.classId) ?? 0) + entry.confidence)
    const latest = seen[seen.length - 1]
    const bestClass = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? latest.classId
    const bestEntries = passing.filter((entry) => entry.classId === bestClass)
    const hits = bestEntries.length
    const confidence = hits ? bestEntries.reduce((sum, entry) => sum + entry.confidence, 0) / hits : latest.confidence

    // Strongest competing class across the window: either a different winning class in some frame,
    // or a runner-up score reported for the same box.
    let competitor: { classId: number; confidence: number } | null = null
    for (const entry of seen) {
      const options = entry.classId === bestClass ? entry.alternatives : [{ classId: entry.classId, confidence: entry.confidence }, ...entry.alternatives]
      for (const option of options) {
        if (option.classId === bestClass) continue
        if (!competitor || option.confidence > competitor.confidence) competitor = { classId: option.classId, confidence: option.confidence }
      }
    }

    let state: DetectionState = 'tentative'
    if (hits >= policy.confirmHits) {
      state = competitor && competitor.confidence >= confidence - policy.ambiguityMargin && competitor.confidence >= policy.candidateFloor ? 'ambiguous' : 'confirmed'
    }
    const box = track.box
    return {
      id: `track-${track.id}`,
      classId: bestClass,
      className: this.nameFor(bestClass),
      label: this.labelFor(bestClass),
      confidence,
      boundingBox: box,
      bbox: box,
      center: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      source: 'camera',
      confirmed: false,
      state,
      alternative: state === 'ambiguous' && competitor
        ? { className: this.nameFor(competitor.classId), label: this.labelFor(competitor.classId), confidence: competitor.confidence }
        : undefined,
    }
  }
}
