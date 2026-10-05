// Works out which components a project uses, so Learn Mode can teach them.
// Components come from the compiled sketch (libraries, calls, pin names and the simulated run)
// and from the Camera Scanner inventory (camera detections and manually added parts).

import { PROFILE_TO_LESSON, type LessonComponentId } from '../data/componentLessons'
import type { SimulationRun } from './arduinoSim'

export type ComponentSource = 'code' | 'camera' | 'manual'

export type ProjectComponent = {
  id: LessonComponentId
  sources: ComponentSource[]
  pins: { role: string; pin: string }[]
  evidence: { line: number; text: string }[]
  inferred?: string
}

export type InventoryPart = { profileId: string; source: 'camera' | 'manual' }

// Learn Mode selection key for a component lesson.
export function lessonKeyFor(part: ProjectComponent): string {
  return `part-${part.id}`
}

const ORDER: LessonComponentId[] = [
  'ultrasonic', 'servo', 'mpu6050', 'dht', 'pir', 'ldr', 'potentiometer', 'push_button', 'buzzer', 'relay', 'lcd',
  'led', 'resistor', 'serial', 'arduino_uno', 'esp8266', 'breadboard', 'jumper_wire',
]

// Variable / #define names → the component and pin role they usually stand for.
const NAME_RULES: { pattern: RegExp; id: LessonComponentId; role: string }[] = [
  { pattern: /trig/, id: 'ultrasonic', role: 'TRIG' },
  { pattern: /echo/, id: 'ultrasonic', role: 'ECHO' },
  { pattern: /servo/, id: 'servo', role: 'SIGNAL' },
  { pattern: /buzz|piezo|speaker|beep/, id: 'buzzer', role: 'SIGNAL' },
  { pattern: /relay/, id: 'relay', role: 'IN' },
  { pattern: /pir|motion/, id: 'pir', role: 'OUT' },
  { pattern: /dht/, id: 'dht', role: 'DATA' },
  { pattern: /ldr|photo|lightsens|light_sens/, id: 'ldr', role: 'SIGNAL' },
  { pattern: /pot|knob/, id: 'potentiometer', role: 'WIPER' },
  { pattern: /button|btn|switch|key/, id: 'push_button', role: 'SIGNAL' },
  { pattern: /led|lamp|^red|^green|^yellow|^blue|^white/, id: 'led', role: 'SIGNAL' },
]

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
}

function pinId(token: string): string | null {
  if (token === 'LED_BUILTIN') return 'D13'
  if (/^A[0-5]$/.test(token)) return token
  if (!/^\d{1,2}$/.test(token)) return null
  const n = Number(token)
  if (n <= 13) return `D${n}`
  if (n <= 19) return `A${n - 14}`
  return null
}

export function detectFromSketch(source: string, run: SimulationRun | null): ProjectComponent[] {
  const rawLines = source.split(/\r?\n/)
  const lines = stripComments(source).split('\n')
  const found = new Map<LessonComponentId, ProjectComponent>()

  const add = (id: LessonComponentId, line?: number, pin?: { role: string; pin: string | null }, inferred?: string) => {
    const part = found.get(id) ?? { id, sources: ['code'], pins: [], evidence: [] }
    if (line && part.evidence.length < 4 && !part.evidence.some((item) => item.line === line)) part.evidence.push({ line, text: rawLines[line - 1]?.trim() ?? '' })
    if (pin?.pin && !part.pins.some((item) => item.pin === pin.pin)) part.pins.push({ role: pin.role, pin: pin.pin })
    if (inferred && !found.has(id)) part.inferred = inferred
    found.set(id, part)
  }

  // Pin constants: `#define TRIG 9`, `const int echoPin = 10;`, `int red = 2, yellow = 3;`
  const constants = new Map<string, { pin: string; line: number }>()
  lines.forEach((line, index) => {
    const define = line.match(/#define\s+(\w+)\s+(A[0-5]|\d{1,2}|LED_BUILTIN)\b/)
    if (define && pinId(define[2])) constants.set(define[1], { pin: pinId(define[2])!, line: index + 1 })
    if (/^\s*(?:(?:static|const|constexpr|volatile)\s+)*(?:unsigned\s+)?(?:int|byte|uint8_t|int8_t|short|long|uint16_t|int16_t)\b/.test(line)) {
      for (const match of line.matchAll(/(\w+)\s*=\s*(A[0-5]|\d{1,2}|LED_BUILTIN)\b(?!\s*[.*/+-])/g)) {
        const pin = pinId(match[2])
        if (pin) constants.set(match[1], { pin, line: index + 1 })
      }
    }
  })
  const resolve = (token: string): string | null => pinId(token) ?? constants.get(token)?.pin ?? null

  const servoNames = new Set<string>()
  const analogReads: { pin: string | null; line: number }[] = []
  const pullupPins: { pin: string | null; line: number }[] = []
  const writtenPins: { pin: string | null; line: number }[] = []
  const usesI2c = /Wire\.begin|#include\s*<Wire\.h>/.test(source)

  lines.forEach((line, index) => {
    const at = index + 1
    for (const match of line.matchAll(/\bServo\s+(\w+)/g)) { servoNames.add(match[1]); add('servo', at) }
    if (/#include\s*<Servo\.h>/.test(line)) add('servo', at)
    for (const match of line.matchAll(/(\w+)(?:\[[^\]]*\])?\.attach\s*\(\s*(\w+)/g)) {
      if (servoNames.has(match[1])) add('servo', at, { role: 'SIGNAL', pin: resolve(match[2]) })
    }
    for (const match of line.matchAll(/\bpulseIn(?:Long)?\s*\(\s*(\w+)/g)) add('ultrasonic', at, { role: 'ECHO', pin: resolve(match[1]) })
    if (/\bNewPing\b/.test(line)) add('ultrasonic', at)
    for (const match of line.matchAll(/\btone\s*\(\s*(\w+)/g)) add('buzzer', at, { role: 'SIGNAL', pin: resolve(match[1]) })
    if (/MPU_?6050|\bmpu\b/i.test(line) || (usesI2c && /Wire\.(?:beginTransmission|requestFrom)\s*\(\s*0x6[89]\b/.test(line))) {
      add('mpu6050', at, { role: 'SDA', pin: 'A4' })
      add('mpu6050', undefined, { role: 'SCL', pin: 'A5' })
    }
    if (/LiquidCrystal/.test(line)) {
      add('lcd', at)
      if (/LiquidCrystal_I2C/.test(line)) { add('lcd', undefined, { role: 'SDA', pin: 'A4' }); add('lcd', undefined, { role: 'SCL', pin: 'A5' }) }
    }
    if (/\bDHT(?:11|22)?\b|\bdht\./.test(line)) {
      const pin = line.match(/\bDHT\s+\w+\s*\(\s*(\w+)/)
      add('dht', at, pin ? { role: 'DATA', pin: resolve(pin[1]) } : undefined)
    }
    if (/Serial\.begin/.test(line)) { add('serial', at, { role: 'TX', pin: 'D1' }); add('serial', undefined, { role: 'RX', pin: 'D0' }) }
    for (const match of line.matchAll(/\banalogRead\s*\(\s*(\w+)/g)) analogReads.push({ pin: resolve(match[1]) ?? (/^[0-5]$/.test(match[1]) ? `A${match[1]}` : null), line: at })
    for (const match of line.matchAll(/\bpinMode\s*\(\s*(\w+)\s*,\s*INPUT_PULLUP/g)) pullupPins.push({ pin: resolve(match[1]), line: at })
    for (const match of line.matchAll(/\b(?:digitalWrite|analogWrite)\s*\(\s*(\w+)/g)) writtenPins.push({ pin: resolve(match[1]), line: at })
  })

  // Pin names tell us what is wired where (trigPin, buzzerPin, ledRed, …).
  for (const [name, { pin, line }] of constants) {
    const rule = NAME_RULES.find((candidate) => candidate.pattern.test(name.toLowerCase()))
    if (rule) add(rule.id, line, { role: rule.role, pin })
  }

  const claimed = () => new Set([...found.values()].flatMap((part) => part.pins.map((item) => item.pin)))

  for (const read of analogReads) {
    if (read.pin && claimed().has(read.pin)) continue
    add('potentiometer', read.line, { role: 'WIPER', pin: read.pin }, `analogRead() on ${read.pin ?? 'an analog pin'}. Shown as a potentiometer; any analog sensor is read the same way.`)
  }
  for (const pullup of pullupPins) {
    if (pullup.pin && claimed().has(pullup.pin)) continue
    add('push_button', pullup.line, { role: 'SIGNAL', pin: pullup.pin }, `${pullup.pin ?? 'A pin'} uses INPUT_PULLUP, which is how buttons and switches are usually wired.`)
  }

  // Any remaining driven output is most likely an LED (D13 is the on-board one).
  const outputs = new Map<string, number>()
  for (const event of run?.events ?? []) {
    if (event.pin && (event.kind === 'digitalWrite' || event.kind === 'analogWrite' || (event.kind === 'pinMode' && event.result.endsWith('OUTPUT')))) {
      if (!outputs.has(event.pin.id)) outputs.set(event.pin.id, event.line)
    }
  }
  if (!run) for (const write of writtenPins) if (write.pin && !outputs.has(write.pin)) outputs.set(write.pin, write.line)
  for (const [pin, line] of outputs) {
    if (pin === 'D0' || pin === 'D1' || claimed().has(pin)) continue
    add('led', line, { role: 'SIGNAL', pin }, pin === 'D13' ? 'D13 drives the Uno\'s built-in LED.' : `${pin} is driven as an output. Shown as an LED.`)
  }
  if (found.has('led')) add('resistor', undefined, undefined, 'Every LED needs a series resistor (220–330 Ω) to limit its current.')

  return sortParts([...found.values()])
}

function sortParts(parts: ProjectComponent[]): ProjectComponent[] {
  return parts.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
}

export function mergeProjectComponents(fromCode: ProjectComponent[], inventory: InventoryPart[]): ProjectComponent[] {
  const merged = new Map(fromCode.map((part) => [part.id, { ...part, sources: [...part.sources] }]))
  for (const item of inventory) {
    const id = PROFILE_TO_LESSON[item.profileId]
    if (!id) continue
    const existing = merged.get(id)
    if (existing) { if (!existing.sources.includes(item.source)) existing.sources.push(item.source) }
    else merged.set(id, { id, sources: [item.source], pins: [], evidence: [] })
  }
  return sortParts([...merged.values()])
}
