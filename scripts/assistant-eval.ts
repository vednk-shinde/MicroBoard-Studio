// Test cases for MicroBot. Sends each question to Claude with the same settings as api/chat.ts and
// checks the reply. Needs ANTHROPIC_API_KEY. Run with: npm run assistant:eval
import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from '../src/assistant/knowledge'

type TestCase = {
  name: string
  question: string
  context?: string
  mustMatch?: RegExp[]
  mustNotMatch?: RegExp[]
  maxLength?: number
}

const OUT_OF_DOMAIN = /outside my domain|not (in|within) my domain|only (handle|help with) arduino/i
const SELF_REVEAL = /\b(claude|anthropic|language model|as an ai)\b/i

const CASES: TestCase[] = [
  { name: 'greeting', question: 'hi', mustMatch: [/MicroBot/], mustNotMatch: [SELF_REVEAL], maxLength: 400 },
  { name: 'greeting 2', question: 'hello there!', mustMatch: [/MicroBot/], maxLength: 400 },
  { name: 'identity', question: 'who are you? are you chatgpt?', mustMatch: [/MicroBot/], mustNotMatch: [SELF_REVEAL] },
  { name: 'off-topic: geography', question: 'What is the capital of France?', mustMatch: [OUT_OF_DOMAIN], mustNotMatch: [/Paris/] },
  { name: 'off-topic: web scraping', question: 'write a python script that scrapes amazon prices', mustMatch: [OUT_OF_DOMAIN], mustNotMatch: [/import requests|BeautifulSoup/] },
  { name: 'off-topic: joke', question: 'tell me a joke about cats', mustMatch: [OUT_OF_DOMAIN] },
  { name: 'wiring: HC-SR04', question: 'how do I connect an HC-SR04 ultrasonic sensor to my Arduino Uno and read the distance?', mustMatch: [/TRIG/i, /ECHO/i, /5\s?V/i, /pulseIn/, /```cpp/] },
  { name: 'code: blink D8', question: 'write code to blink an LED on pin 8 every 500 ms', mustMatch: [/```cpp/, /pinMode\(\s*8\s*,\s*OUTPUT\s*\)/, /delay\(\s*500\s*\)/] },
  { name: 'project: radar', question: 'I want to build a radar with a servo and an ultrasonic sensor. What do I connect where, and give me the code', mustMatch: [/Servo/, /\|.*\|/, /\.attach\(/, /pulseIn/, /```cpp/] },
  { name: 'facts: PWM pins', question: 'which pins on the Uno support PWM?', mustMatch: [/\b3\b/, /\b5\b/, /\b6\b/, /\b9\b/, /\b10\b/, /\b11\b/] },
  { name: 'wiring: MPU6050', question: 'how do I wire an MPU6050 to the uno', mustMatch: [/A4/, /A5/, /0x68/] },
  { name: 'safety: servos on 5V', question: 'can I power 4 servos straight from the Arduino 5V pin?', mustMatch: [/external|separate/i, /GND|ground/i] },
  { name: 'wiring: HC-05 level shift', question: 'how do I connect an HC-05 bluetooth module to the uno?', mustMatch: [/divider|level shift/i, /SoftwareSerial|RX|TX/] },
  { name: 'registers', question: 'what does DDRB do?', mustMatch: [/direction/i, /output|input/i] },
  { name: 'compile error', question: "my sketch says expected ';' before '}' token, what does that mean?", mustMatch: [/semicolon|`;`/i] },
  { name: 'website: code visualizer', question: 'what does the Code Visualizer on this website do?', mustMatch: [/simulat/i, /compile/i] },
  { name: 'website: YOLO model', question: 'what YOLO model does the camera scanner use and what can it detect?', mustMatch: [/YOLO11n/i, /ESP8266/i, /other.?board|two classes|2 classes/i] },
  {
    name: 'uses the user\'s sketch',
    question: "why doesn't my LED turn on?",
    context: 'Current page: Code Visualizer\nProject components: LED (SIGNAL=D7)\nSketch in the Code Visualizer editor:\nvoid setup() {\n}\n\nvoid loop() {\n  digitalWrite(7, HIGH);\n}',
    mustMatch: [/pinMode\(\s*7\s*,\s*OUTPUT\s*\)/],
  },
]

const client = new Anthropic()
const system = buildSystemPrompt()

async function ask(test: TestCase): Promise<string> {
  const content = test.context ? `<app_context>\n${test.context}\n</app_context>\n\n${test.question}` : test.question
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  })
  if (response.stop_reason === 'refusal') return '[refused]'
  return response.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
}

let failures = 0
for (const test of CASES) {
  const started = Date.now()
  const reply = await ask(test)
  const problems = [
    ...(test.mustMatch ?? []).filter((pattern) => !pattern.test(reply)).map((pattern) => `missing ${pattern}`),
    ...(test.mustNotMatch ?? []).filter((pattern) => pattern.test(reply)).map((pattern) => `should not contain ${pattern}`),
    ...(test.maxLength && reply.length > test.maxLength ? [`too long (${reply.length} > ${test.maxLength} chars)`] : []),
  ]
  if (problems.length) failures++
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${test.name}  (${((Date.now() - started) / 1000).toFixed(1)} s)`)
  if (problems.length) console.log(`      ${problems.join('; ')}\n      reply: ${reply.slice(0, 300).replace(/\n/g, ' ')}`)
}
console.log(`\n${CASES.length - failures}/${CASES.length} passed`)
process.exitCode = failures ? 1 : 0
