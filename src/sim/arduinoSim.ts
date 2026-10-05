// A small Arduino (C++ subset) compiler + ATmega328P simulator.
// It parses a sketch, reports compile errors with line numbers, then runs setup() once and
// loop() a few times against a register-level model of the Uno, recording every hardware
// operation as a step-by-step trace for the Code Visualizer.

import { pinMap, type PinDefinition, type PinLevel, type PinMode } from '../data/pins'

export type Port = 'B' | 'C' | 'D'

export type TraceStep = { kind: string; title: string; description: string }

export type Snapshot = {
  regs: Record<string, number>
  pwm: Record<string, number>
  tones: Record<string, number>
  servos: Record<string, number>
  timeMs: number
}

export type SimEventKind = 'pinMode' | 'digitalWrite' | 'digitalRead' | 'analogWrite' | 'analogRead' | 'register' | 'delay' | 'serial' | 'tone' | 'servo' | 'pulse' | 'i2c'

export type SimEvent = {
  index: number
  kind: SimEventKind
  line: number
  call: string
  pin: PinDefinition | null
  steps: TraceStep[]
  result: string
  explanation: string
  phase: 'setup' | 'loop'
  loopIteration: number
  before: Snapshot
  after: Snapshot
}

export type Diagnostic = { line: number; message: string }

export type SimulationRun = {
  ok: true
  events: SimEvent[]
  serial: string
  warnings: Diagnostic[]
  runtimeError: Diagnostic | null
  loopIterations: number
  stopReason: string
  final: Snapshot
}

export type CompileResult = { ok: false; errors: Diagnostic[]; warnings: Diagnostic[] } | SimulationRun

const MAX_LOOP_ITERATIONS = 3
const MAX_EVENTS = 400
const MAX_OPS = 200_000
const MAX_TIME_MS = 120_000
const MAX_CALL_DEPTH = 120
const OP_TIME_MS = 0.0005

const PORT_REGISTERS = ['DDRB', 'PORTB', 'PINB', 'DDRC', 'PORTC', 'PINC', 'DDRD', 'PORTD', 'PIND']

const PWM_TIMERS: Record<string, { timer: number; ocr: string; hz: number }> = {
  D3: { timer: 2, ocr: 'OCR2B', hz: 490 },
  D5: { timer: 0, ocr: 'OCR0B', hz: 980 },
  D6: { timer: 0, ocr: 'OCR0A', hz: 980 },
  D9: { timer: 1, ocr: 'OCR1A', hz: 490 },
  D10: { timer: 1, ocr: 'OCR1B', hz: 490 },
  D11: { timer: 2, ocr: 'OCR2A', hz: 490 },
}

const BUILTIN_CONSTANTS: Record<string, number> = {
  HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, LED_BUILTIN: 13,
  A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
  true: 1, false: 0, Serial: 1, NULL: 0,
  DEC: 10, HEX: 16, OCT: 8, BIN: 2,
  DEFAULT: 1, EXTERNAL: 0, INTERNAL: 3,
  LSBFIRST: 0, MSBFIRST: 1, CHANGE: 1, FALLING: 2, RISING: 3,
}
const FLOAT_CONSTANTS: Record<string, number> = { PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI }
for (const port of ['B', 'C', 'D']) {
  for (let bit = 0; bit < 8; bit++) {
    BUILTIN_CONSTANTS[`P${port}${bit}`] = bit
    BUILTIN_CONSTANTS[`PORT${port}${bit}`] = bit
    BUILTIN_CONSTANTS[`DD${port}${bit}`] = bit
    BUILTIN_CONSTANTS[`PIN${port}${bit}`] = bit
  }
}

// name -> [min args, max args]
const BUILTIN_FUNCTIONS: Record<string, [number, number]> = {
  pinMode: [2, 2], digitalWrite: [2, 2], digitalRead: [1, 1], analogWrite: [2, 2], analogRead: [1, 1], analogReference: [1, 1],
  delay: [1, 1], delayMicroseconds: [1, 1], millis: [0, 0], micros: [0, 0], tone: [2, 3], noTone: [1, 1],
  map: [5, 5], constrain: [3, 3], min: [2, 2], max: [2, 2], abs: [1, 1], sqrt: [1, 1], sq: [1, 1], pow: [2, 2],
  sin: [1, 1], cos: [1, 1], tan: [1, 1], floor: [1, 1], ceil: [1, 1], round: [1, 1], random: [1, 2], randomSeed: [1, 1],
  pulseIn: [2, 3], pulseInLong: [2, 3],
  bitRead: [2, 2], bitSet: [2, 2], bitClear: [2, 2], bitWrite: [3, 3], bit: [1, 1], _BV: [1, 1], highByte: [1, 1], lowByte: [1, 1], F: [1, 1],
}

const SERIAL_METHODS: Record<string, [number, number]> = {
  begin: [1, 2], end: [0, 0], print: [1, 2], println: [0, 2], write: [1, 1], available: [0, 0], read: [0, 0], peek: [0, 0], flush: [0, 0],
}

const WIRE_METHODS: Record<string, [number, number]> = {
  begin: [0, 1], end: [0, 0], setClock: [1, 1], beginTransmission: [1, 1], write: [1, 2], endTransmission: [0, 1], requestFrom: [2, 3], read: [0, 0], available: [0, 0],
}

const SERVO_METHODS: Record<string, [number, number]> = {
  attach: [1, 3], detach: [0, 0], write: [1, 1], writeMicroseconds: [1, 1], read: [0, 0], readMicroseconds: [0, 0], attached: [0, 0],
}

// Libraries the simulator models. Objects from any other library still compile, but their calls are skipped.
const SIMULATED_LIBRARIES = new Set(['Arduino.h', 'Servo.h', 'Wire.h'])

const I2C_DEVICES: Record<number, string> = {
  0x68: 'MPU6050', 0x69: 'MPU6050 (AD0 high)', 0x27: 'LCD backpack (PCF8574)', 0x3f: 'LCD backpack (PCF8574A)',
  0x3c: 'SSD1306 OLED', 0x3d: 'SSD1306 OLED', 0x76: 'BMP280 / BME280', 0x77: 'BMP280 / BME280', 0x48: 'ADS1115 / TMP102', 0x57: 'EEPROM',
}

// Raw MPU6050 readings returned from registers 0x3B–0x48 once the chip is awake:
// accel X/Y/Z ≈ 0.02 g, -0.01 g, 1.00 g · temperature ≈ 25 °C · gyro ≈ 0 °/s.
const MPU6050_DATA = [0x01, 0x48, 0xff, 0x38, 0x40, 0x00, 0xf0, 0xb0, 0x00, 0x10, 0xff, 0xf0, 0x00, 0x05]

const TYPE_WORDS = new Set(['void', 'int', 'long', 'short', 'char', 'byte', 'bool', 'boolean', 'float', 'double', 'unsigned', 'signed', 'word', 'String', 'size_t', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'uint64_t', 'int64_t', 'auto'])
const QUALIFIERS = new Set(['const', 'static', 'volatile', 'constexpr', 'inline', 'register'])
const UNSUPPORTED_KEYWORDS = new Set(['class', 'struct', 'enum', 'union', 'template', 'typedef', 'namespace', 'using', 'new', 'delete', 'goto', 'operator', 'virtual'])

const INT_TYPES: Record<string, [number, boolean]> = {
  int: [16, true], short: [16, true], int16_t: [16, true],
  'unsigned int': [16, false], word: [16, false], uint16_t: [16, false], 'unsigned short': [16, false], size_t: [16, false],
  long: [32, true], int32_t: [32, true], 'unsigned long': [32, false], uint32_t: [32, false],
  byte: [8, false], uint8_t: [8, false], 'unsigned char': [8, false], int8_t: [8, true], 'signed char': [8, true], char: [8, true],
  'long long': [64, true], int64_t: [64, true], 'unsigned long long': [64, false], uint64_t: [64, false],
}

// ---------------------------------------------------------------- errors

class CompileError extends Error {
  line: number
  constructor(line: number, message: string) {
    super(message)
    this.line = line
  }
}

class RuntimeError extends Error {
  line: number
  constructor(line: number, message: string) {
    super(message)
    this.line = line
  }
}

class StopSimulation extends Error {}

// ---------------------------------------------------------------- lexer

type Token = { t: 'num' | 'str' | 'chr' | 'id' | 'op' | 'eof'; v: string; line: number; num: number; float: boolean }

const OPERATORS = ['<<=', '>>=', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '->', '::', '+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.', '(', ')', '{', '}', '[', ']']

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"' }

function lex(src: string, startLine: number, onDirective: ((text: string, line: number) => void) | null): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = startLine
  let lineStart = true
  const at = (k: number) => src[k] ?? ''
  const push = (t: Token['t'], v: string, num = 0, float = false) => tokens.push({ t, v, line, num, float })

  while (i < src.length) {
    const c = src[i]
    if (c === '\n') { line++; i++; lineStart = true; continue }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === '/' && at(i + 1) === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && at(i + 1) === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end < 0) throw new CompileError(line, 'unterminated comment')
      for (let k = i; k < end; k++) if (src[k] === '\n') line++
      i = end + 2
      continue
    }
    if (c === '#' && lineStart && onDirective) {
      let j = i
      while (j < src.length && src[j] !== '\n') j++
      onDirective(src.slice(i + 1, j).replace(/\/\/.*$/, '').trim(), line)
      i = j
      continue
    }
    lineStart = false

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(at(i + 1)))) {
      let j = i
      let value: number
      let float = false
      if (c === '0' && /[xX]/.test(at(i + 1))) {
        j = i + 2
        while (/[0-9a-fA-F]/.test(at(j))) j++
        value = parseInt(src.slice(i + 2, j), 16)
      } else if (c === '0' && /[bB]/.test(at(i + 1))) {
        j = i + 2
        while (/[01]/.test(at(j))) j++
        value = parseInt(src.slice(i + 2, j), 2)
      } else {
        while (/[0-9.]/.test(at(j))) j++
        if (/[eE]/.test(at(j))) {
          j++
          if (/[+-]/.test(at(j))) j++
          while (/[0-9]/.test(at(j))) j++
        }
        const text = src.slice(i, j)
        float = /[.eE]/.test(text)
        value = Number(text)
      }
      if (Number.isNaN(value)) throw new CompileError(line, `invalid number '${src.slice(i, j)}'`)
      while (/[uUlLfF]/.test(at(j))) { if (/[fF]/.test(at(j))) float = true; j++ }
      if (/[A-Za-z_]/.test(at(j))) throw new CompileError(line, `invalid suffix on number '${src.slice(i, j + 1)}'`)
      push('num', src.slice(i, j), value, float)
      i = j
      continue
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (/\w/.test(at(j))) j++
      const word = src.slice(i, j)
      if (/^B[01]{1,8}$/.test(word)) push('num', word, parseInt(word.slice(1), 2))
      else push('id', word)
      i = j
      continue
    }

    if (c === '"' || c === "'") {
      let j = i + 1
      let text = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\n') throw new CompileError(line, `missing terminating ${c} character`)
        if (src[j] === '\\') { text += ESCAPES[at(j + 1)] ?? at(j + 1); j += 2 } else { text += src[j]; j++ }
      }
      if (j >= src.length) throw new CompileError(line, `missing terminating ${c} character`)
      if (c === '"') push('str', text)
      else {
        if (text.length !== 1) throw new CompileError(line, `character constant '${text}' must hold exactly one character`)
        push('chr', text, text.charCodeAt(0))
      }
      i = j + 1
      continue
    }

    const op = OPERATORS.find((candidate) => src.startsWith(candidate, i))
    if (!op) throw new CompileError(line, `stray '${c}' in program`)
    push('op', op)
    i += op.length
  }
  tokens.push({ t: 'eof', v: 'end of file', line, num: 0, float: false })
  return tokens
}

function tokenize(src: string, warnings: Diagnostic[]): Token[] {
  const macros = new Map<string, Token[]>()
  const raw = lex(src, 1, (directive, line) => {
    const include = directive.match(/^include\s*[<"]([^>"]+)[>"]/)
    if (include) {
      if (!SIMULATED_LIBRARIES.has(include[1])) warnings.push({ line, message: `#include <${include[1]}>: this library isn't simulated, so calls on its objects are skipped.` })
      return
    }
    const define = directive.match(/^define\s+([A-Za-z_]\w*)(\()?\s*(.*)$/)
    if (define) {
      if (define[2]) throw new CompileError(line, `function-like macro '${define[1]}' isn't supported by the simulator`)
      macros.set(define[1], lex(define[3], line, null).slice(0, -1))
      return
    }
    if (/^pragma\b/.test(directive)) return
    throw new CompileError(line, `preprocessor directive '#${directive.split(/\s/)[0]}' isn't supported by the simulator`)
  })

  const expand = (tokens: Token[], active: Set<string>): Token[] => tokens.flatMap((token) => {
    const body = token.t === 'id' ? macros.get(token.v) : undefined
    if (!body || active.has(token.v)) return [token]
    return expand(body.map((part) => ({ ...part, line: token.line })), new Set([...active, token.v]))
  })
  return expand(raw, new Set())
}

// ---------------------------------------------------------------- AST

type Expr =
  | { k: 'num'; line: number; v: number; float: boolean }
  | { k: 'str'; line: number; v: string }
  | { k: 'chr'; line: number; v: number }
  | { k: 'id'; line: number; name: string }
  | { k: 'unary'; line: number; op: string; arg: Expr }
  | { k: 'update'; line: number; op: '++' | '--'; prefix: boolean; target: Expr }
  | { k: 'bin'; line: number; op: string; l: Expr; r: Expr }
  | { k: 'assign'; line: number; op: string; target: Expr; value: Expr }
  | { k: 'cond'; line: number; test: Expr; cons: Expr; alt: Expr }
  | { k: 'call'; line: number; name: string; obj: string | null; index?: Expr; args: Expr[] }
  | { k: 'index'; line: number; target: Expr; index: Expr }
  | { k: 'cast'; line: number; type: string; arg: Expr }
  | { k: 'list'; line: number; items: Expr[] }
  | { k: 'seq'; line: number; items: Expr[] }
  | { k: 'sizeof'; line: number; arg: Expr | null; type: string | null }

type Declarator = { name: string; line: number; isArray: boolean; size: Expr | null; init: Expr | null; ctorArgs?: Expr[] }

type Stmt =
  | { k: 'var'; line: number; type: string; isConst: boolean; decls: Declarator[]; isObject?: boolean }
  | { k: 'expr'; line: number; e: Expr }
  | { k: 'if'; line: number; test: Expr; cons: Stmt; alt: Stmt | null }
  | { k: 'while'; line: number; test: Expr; body: Stmt }
  | { k: 'do'; line: number; body: Stmt; test: Expr }
  | { k: 'for'; line: number; init: Stmt | null; test: Expr | null; update: Expr | null; body: Stmt }
  | { k: 'block'; line: number; body: Stmt[] }
  | { k: 'return'; line: number; e: Expr | null }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'empty'; line: number }
  | { k: 'switch'; line: number; disc: Expr; cases: { test: Expr | null; line: number; body: Stmt[] }[] }

type Param = { name: string; type: string; isArray: boolean }
type FunctionDecl = { name: string; ret: string; params: Param[]; body: Stmt; line: number }
type Program = { globals: Stmt[]; fns: Map<string, FunctionDecl> }

// ---------------------------------------------------------------- parser

function normalizeType(words: string[]): string {
  let type = words.join(' ')
  type = type.replace(/\bint$/, (match) => (words.length > 1 ? '' : match)).trim() || 'int'
  if (type === 'unsigned') return 'unsigned int'
  if (type === 'signed') return 'int'
  if (type === 'signed long' || type === 'long signed') return 'long'
  if (type === 'boolean') return 'bool'
  if (type === 'double') return 'float'
  return type
}

class Parser {
  private pos = 0
  private tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(offset = 0): Token { return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] }
  private next(): Token { return this.tokens[this.pos++] ?? this.tokens[this.tokens.length - 1] }
  private isOp(value: string, offset = 0): boolean { const token = this.peek(offset); return token.t === 'op' && token.v === value }
  private eatOp(value: string): boolean { if (this.isOp(value)) { this.pos++; return true } return false }
  private describe(token: Token): string { return token.t === 'eof' ? 'end of file' : token.t === 'str' ? 'string constant' : `'${token.v}'` }
  private expectOp(value: string): Token {
    if (!this.isOp(value)) {
      const token = this.peek()
      const line = value === ';' && this.pos > 0 ? this.tokens[this.pos - 1].line : token.line
      throw new CompileError(line, `expected '${value}' before ${this.describe(token)}`)
    }
    return this.next()
  }
  private expectId(what: string): Token {
    const token = this.peek()
    if (token.t !== 'id') throw new CompileError(token.line, `expected ${what} before ${this.describe(token)}`)
    this.checkKeyword(token)
    return this.next()
  }
  private checkKeyword(token: Token) {
    if (token.t === 'id' && UNSUPPORTED_KEYWORDS.has(token.v)) throw new CompileError(token.line, `'${token.v}' isn't supported by the simulator`)
  }

  private isTypeStart(offset = 0): boolean {
    const token = this.peek(offset)
    return token.t === 'id' && (TYPE_WORDS.has(token.v) || QUALIFIERS.has(token.v))
  }

  private parseType(): { type: string; isConst: boolean } {
    const words: string[] = []
    let isConst = false
    while (this.peek().t === 'id') {
      const word = this.peek().v
      if (QUALIFIERS.has(word)) { if (word === 'const' || word === 'constexpr') isConst = true; this.pos++ }
      else if (TYPE_WORDS.has(word)) { words.push(word); this.pos++ }
      else break
    }
    if (!words.length) throw new CompileError(this.peek().line, `expected a type before ${this.describe(this.peek())}`)
    let type = normalizeType(words)
    if (this.isOp('*')) {
      if (!type.includes('char')) throw new CompileError(this.peek().line, "pointers aren't supported by the simulator")
      this.pos++
      type = 'String'
    }
    if (this.isOp('&')) throw new CompileError(this.peek().line, "references aren't supported by the simulator")
    return { type, isConst }
  }

  parseProgram(): Program {
    const globals: Stmt[] = []
    const fns = new Map<string, FunctionDecl>()
    while (this.peek().t !== 'eof') {
      if (this.eatOp(';')) continue
      const token = this.peek()
      this.checkKeyword(token)
      if (!this.isTypeStart()) {
        if (token.t === 'id' && this.peek(1).t === 'id') { globals.push(this.parseObjectDecl()); continue }
        throw new CompileError(token.line, token.t === 'id' && this.isOp('(', 1)
          ? `'${token.v}(...)' must be inside a function; put it in setup() or loop()`
          : `expected a declaration before ${this.describe(token)}`)
      }
      const { type, isConst } = this.parseType()
      const name = this.expectId('a name')
      if (this.isOp('(')) {
        const fn = this.parseFunction(type, name)
        if (!fn) continue
        if (fns.has(fn.name)) throw new CompileError(fn.line, `redefinition of '${fn.name}()'`)
        fns.set(fn.name, fn)
      } else {
        globals.push(this.parseDeclarators(type, isConst, name))
      }
    }
    return { globals, fns }
  }

  private parseFunction(ret: string, name: Token): FunctionDecl | null {
    this.expectOp('(')
    const params: Param[] = []
    if (this.peek().v === 'void' && this.isOp(')', 1)) this.pos++
    if (!this.isOp(')')) {
      do {
        const { type } = this.parseType()
        const paramName = this.expectId('a parameter name')
        let isArray = false
        if (this.eatOp('[')) { if (!this.isOp(']')) this.parseExpr(); this.expectOp(']'); isArray = true }
        if (this.isOp('=')) throw new CompileError(paramName.line, "default arguments aren't supported by the simulator")
        params.push({ name: paramName.v, type, isArray })
      } while (this.eatOp(','))
    }
    this.expectOp(')')
    if (this.eatOp(';')) return null
    if (!this.isOp('{')) throw new CompileError(this.peek().line, `expected '{' before ${this.describe(this.peek())}`)
    return { name: name.v, ret, params, body: this.parseBlock(), line: name.line }
  }

  private parseDeclarators(type: string, isConst: boolean, first: Token): Stmt {
    const decls: Declarator[] = []
    let name: Token | null = first
    while (true) {
      const current: Token = name ?? this.expectId('a variable name')
      name = null
      let isArray = false
      let size: Expr | null = null
      if (this.eatOp('[')) {
        isArray = true
        if (!this.isOp(']')) size = this.parseExpr()
        this.expectOp(']')
        if (this.isOp('[')) throw new CompileError(this.peek().line, "multi-dimensional arrays aren't supported by the simulator")
      }
      let init: Expr | null = null
      if (this.eatOp('=')) init = this.isOp('{') ? this.parseInitList() : this.parseAssign()
      else if (this.isOp('(')) throw new CompileError(this.peek().line, `constructor-style initialisation of '${current.v}' isn't supported; use '='`)
      if (isArray && !size && !init) throw new CompileError(current.line, `array size missing in '${current.v}'`)
      if (isConst && !init) throw new CompileError(current.line, `uninitialized const '${current.v}'`)
      decls.push({ name: current.v, line: current.line, isArray, size, init })
      if (!this.eatOp(',')) break
    }
    this.expectOp(';')
    return { k: 'var', line: first.line, type, isConst, decls }
  }

  // `Servo myServo;`, `Servo servos[2];`, `LiquidCrystal_I2C lcd(0x27, 16, 2);`: an object of a library class.
  private parseObjectDecl(): Stmt {
    const typeToken = this.next()
    const decls: Declarator[] = []
    do {
      const name = this.expectId('an object name')
      let isArray = false
      let size: Expr | null = null
      if (this.eatOp('[')) { isArray = true; size = this.parseExpr(); this.expectOp(']') }
      const ctorArgs = this.isOp('(') ? this.parseArgs() : []
      if (this.isOp('=')) throw new CompileError(name.line, `initialising library object '${name.v}' with '=' isn't supported by the simulator`)
      decls.push({ name: name.v, line: name.line, isArray, size, init: null, ctorArgs })
    } while (this.eatOp(','))
    this.expectOp(';')
    return { k: 'var', line: typeToken.line, type: typeToken.v, isConst: false, decls, isObject: true }
  }

  private parseInitList(): Expr {
    const open = this.expectOp('{')
    const items: Expr[] = []
    while (!this.isOp('}')) {
      items.push(this.parseAssign())
      if (!this.eatOp(',')) break
    }
    this.expectOp('}')
    return { k: 'list', line: open.line, items }
  }

  private parseBlock(): Stmt {
    const open = this.expectOp('{')
    const body: Stmt[] = []
    while (!this.isOp('}')) {
      if (this.peek().t === 'eof') throw new CompileError(this.peek().line, "expected '}' at end of input")
      body.push(this.parseStatement())
    }
    this.expectOp('}')
    return { k: 'block', line: open.line, body }
  }

  private parseStatement(): Stmt {
    const token = this.peek()
    const line = token.line
    if (this.isOp('{')) return this.parseBlock()
    if (this.eatOp(';')) return { k: 'empty', line }
    this.checkKeyword(token)
    if (token.t === 'id') {
      switch (token.v) {
        case 'if': {
          this.pos++
          this.expectOp('(')
          const test = this.parseExpr()
          this.expectOp(')')
          const cons = this.parseStatement()
          let alt: Stmt | null = null
          if (this.peek().t === 'id' && this.peek().v === 'else') { this.pos++; alt = this.parseStatement() }
          return { k: 'if', line, test, cons, alt }
        }
        case 'while': {
          this.pos++
          this.expectOp('(')
          const test = this.parseExpr()
          this.expectOp(')')
          return { k: 'while', line, test, body: this.parseStatement() }
        }
        case 'do': {
          this.pos++
          const body = this.parseStatement()
          const keyword = this.expectId("'while'")
          if (keyword.v !== 'while') throw new CompileError(keyword.line, `expected 'while' before '${keyword.v}'`)
          this.expectOp('(')
          const test = this.parseExpr()
          this.expectOp(')')
          this.expectOp(';')
          return { k: 'do', line, body, test }
        }
        case 'for': {
          this.pos++
          this.expectOp('(')
          let init: Stmt | null = null
          if (this.isTypeStart()) {
            const { type, isConst } = this.parseType()
            init = this.parseDeclarators(type, isConst, this.expectId('a variable name'))
          } else if (!this.eatOp(';')) {
            init = { k: 'expr', line, e: this.parseExpr(true) }
            this.expectOp(';')
          }
          const test = this.isOp(';') ? null : this.parseExpr()
          this.expectOp(';')
          const update = this.isOp(')') ? null : this.parseExpr(true)
          this.expectOp(')')
          return { k: 'for', line, init, test, update, body: this.parseStatement() }
        }
        case 'switch': return this.parseSwitch()
        case 'return': {
          this.pos++
          const e = this.isOp(';') ? null : this.parseExpr()
          this.expectOp(';')
          return { k: 'return', line, e }
        }
        case 'break': this.pos++; this.expectOp(';'); return { k: 'break', line }
        case 'continue': this.pos++; this.expectOp(';'); return { k: 'continue', line }
        case 'else': throw new CompileError(line, "'else' without a previous 'if'")
        case 'case':
        case 'default': throw new CompileError(line, `'${token.v}' label not within a switch statement`)
      }
      if (this.isTypeStart() && !(TYPE_WORDS.has(token.v) && this.isOp('(', 1))) {
        const { type, isConst } = this.parseType()
        return this.parseDeclarators(type, isConst, this.expectId('a variable name'))
      }
      if (this.peek(1).t === 'id') return this.parseObjectDecl()
    }
    const e = this.parseExpr(true)
    this.expectOp(';')
    return { k: 'expr', line, e }
  }

  private parseSwitch(): Stmt {
    const line = this.next().line
    this.expectOp('(')
    const disc = this.parseExpr()
    this.expectOp(')')
    this.expectOp('{')
    const cases: { test: Expr | null; line: number; body: Stmt[] }[] = []
    while (!this.isOp('}')) {
      const label = this.peek()
      if (label.t === 'id' && label.v === 'case') {
        this.pos++
        const test = this.parseTernary()
        this.expectOp(':')
        cases.push({ test, line: label.line, body: [] })
      } else if (label.t === 'id' && label.v === 'default') {
        this.pos++
        this.expectOp(':')
        cases.push({ test: null, line: label.line, body: [] })
      } else {
        if (!cases.length) throw new CompileError(label.line, "statement in switch before the first 'case'")
        if (label.t === 'eof') throw new CompileError(label.line, "expected '}' at end of input")
        cases[cases.length - 1].body.push(this.parseStatement())
      }
    }
    this.expectOp('}')
    return { k: 'switch', line, disc, cases }
  }

  parseExpr(allowComma = false): Expr {
    const first = this.parseAssign()
    if (!allowComma || !this.isOp(',')) return first
    const items = [first]
    while (this.eatOp(',')) items.push(this.parseAssign())
    return { k: 'seq', line: first.line, items }
  }

  private parseAssign(): Expr {
    const left = this.parseTernary()
    const token = this.peek()
    if (token.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(token.v)) {
      this.pos++
      if (left.k !== 'id' && left.k !== 'index') throw new CompileError(token.line, 'lvalue required as left operand of assignment')
      return { k: 'assign', line: token.line, op: token.v, target: left, value: this.parseAssign() }
    }
    return left
  }

  private parseTernary(): Expr {
    const test = this.parseBinary(0)
    if (!this.isOp('?')) return test
    const line = this.next().line
    const cons = this.parseAssign()
    this.expectOp(':')
    return { k: 'cond', line, test, cons, alt: this.parseAssign() }
  }

  private static LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']]

  private parseBinary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.parseUnary()
    let left = this.parseBinary(level + 1)
    while (this.peek().t === 'op' && Parser.LEVELS[level].includes(this.peek().v)) {
      const op = this.next()
      left = { k: 'bin', line: op.line, op: op.v, l: left, r: this.parseBinary(level + 1) }
    }
    return left
  }

  private parseUnary(): Expr {
    const token = this.peek()
    if (token.t === 'op') {
      if (token.v === '++' || token.v === '--') {
        this.pos++
        const target = this.parseUnary()
        if (target.k !== 'id' && target.k !== 'index') throw new CompileError(token.line, `lvalue required as operand of '${token.v}'`)
        return { k: 'update', line: token.line, op: token.v, prefix: true, target }
      }
      if (['-', '+', '!', '~'].includes(token.v)) { this.pos++; return { k: 'unary', line: token.line, op: token.v, arg: this.parseUnary() } }
      if (token.v === '*' || token.v === '&') throw new CompileError(token.line, "pointers aren't supported by the simulator")
      if (token.v === '(' && this.isTypeStart(1)) {
        this.pos++
        const { type } = this.parseType()
        this.expectOp(')')
        return { k: 'cast', line: token.line, type, arg: this.parseUnary() }
      }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary()
    while (true) {
      const token = this.peek()
      if (token.t !== 'op') break
      if (token.v === '[') {
        this.pos++
        const index = this.parseExpr()
        this.expectOp(']')
        expr = { k: 'index', line: token.line, target: expr, index }
      } else if (token.v === '++' || token.v === '--') {
        if (expr.k !== 'id' && expr.k !== 'index') throw new CompileError(token.line, `lvalue required as operand of '${token.v}'`)
        this.pos++
        expr = { k: 'update', line: token.line, op: token.v, prefix: false, target: expr }
      } else if (token.v === '.' && expr.k === 'index' && expr.target.k === 'id' && this.peek(1).t === 'id' && this.isOp('(', 2)) {
        this.pos++
        const member = this.next()
        expr = { k: 'call', line: token.line, name: member.v, obj: expr.target.name, index: expr.index, args: this.parseArgs() }
      } else if (token.v === '.' || token.v === '->' || token.v === '::') {
        throw new CompileError(token.line, `'${expr.k === 'id' ? expr.name : 'expression'}' has no member access in the simulator (only Serial.* is supported)`)
      } else break
    }
    return expr
  }

  private parseArgs(): Expr[] {
    this.expectOp('(')
    const args: Expr[] = []
    if (!this.isOp(')')) {
      do args.push(this.parseAssign())
      while (this.eatOp(','))
    }
    this.expectOp(')')
    return args
  }

  private parsePrimary(): Expr {
    const token = this.next()
    switch (token.t) {
      case 'num': return { k: 'num', line: token.line, v: token.num, float: token.float }
      case 'chr': return { k: 'chr', line: token.line, v: token.num }
      case 'str': {
        let text = token.v
        while (this.peek().t === 'str') text += this.next().v
        return { k: 'str', line: token.line, v: text }
      }
      case 'id': {
        this.checkKeyword(token)
        if (token.v === 'sizeof') {
          this.expectOp('(')
          const sized: Expr = this.isTypeStart()
            ? { k: 'sizeof', line: token.line, arg: null, type: this.parseType().type }
            : { k: 'sizeof', line: token.line, arg: this.parseExpr(), type: null }
          this.expectOp(')')
          return sized
        }
        if (TYPE_WORDS.has(token.v) && this.isOp('(')) {
          const args = this.parseArgs()
          if (args.length !== 1) throw new CompileError(token.line, `${token.v}() conversion takes one value`)
          return { k: 'cast', line: token.line, type: normalizeType([token.v]), arg: args[0] }
        }
        if (this.isOp('.') && this.peek(1).t === 'id') {
          this.pos++
          const member = this.next()
          if (!this.isOp('(')) throw new CompileError(member.line, `'${token.v}.${member.v}' isn't supported by the simulator`)
          return { k: 'call', line: token.line, name: member.v, obj: token.v, args: this.parseArgs() }
        }
        if (this.isOp('(')) return { k: 'call', line: token.line, name: token.v, obj: null, args: this.parseArgs() }
        return { k: 'id', line: token.line, name: token.v }
      }
      case 'op':
        if (token.v === '(') {
          const inner = this.parseExpr(true)
          this.expectOp(')')
          return inner
        }
        throw new CompileError(token.line, `expected an expression before '${token.v}'`)
      default:
        throw new CompileError(token.line, 'expected an expression before end of file')
    }
  }
}

// ---------------------------------------------------------------- semantic check

type VarInfo = { isConst: boolean; isArray: boolean; objType?: string }
type ScopeInfo = Map<string, VarInfo>

function checkProgram(program: Program): Diagnostic[] {
  const errors: Diagnostic[] = []
  const seen = new Set<string>()
  const report = (line: number, message: string) => {
    const key = `${line}:${message}`
    if (!seen.has(key)) { seen.add(key); errors.push({ line, message }) }
  }
  const scopes: ScopeInfo[] = [new Map()]
  const lookup = (name: string) => { for (let i = scopes.length - 1; i >= 0; i--) { const found = scopes[i].get(name); if (found) return found } return null }
  const declare = (name: string, line: number, info: VarInfo) => {
    const scope = scopes[scopes.length - 1]
    if (scope.has(name)) report(line, `redeclaration of '${name}'`)
    scope.set(name, info)
  }
  const knownName = (name: string) => lookup(name) || name in BUILTIN_CONSTANTS || name in FLOAT_CONSTANTS || PORT_REGISTERS.includes(name)

  const checkTarget = (target: Expr, line: number) => {
    const base = target.k === 'index' ? target.target : target
    if (base.k !== 'id') return
    const info = lookup(base.name)
    if (!info && (base.name in BUILTIN_CONSTANTS || base.name in FLOAT_CONSTANTS)) report(line, `assignment of read-only value '${base.name}'`)
    else if (info?.objType) report(line, `can't assign to library object '${base.name}'`)
    else if (info?.isConst) report(line, `assignment of read-only variable '${base.name}'`)
    else if (info?.isArray && target.k === 'id') report(line, `invalid array assignment to '${base.name}'`)
  }

  const expr = (e: Expr | null): void => {
    if (!e) return
    switch (e.k) {
      case 'id':
        if (!knownName(e.name)) report(e.line, `'${e.name}' was not declared in this scope`)
        return
      case 'unary': return expr(e.arg)
      case 'update': checkTarget(e.target, e.line); return expr(e.target)
      case 'bin': expr(e.l); return expr(e.r)
      case 'assign': checkTarget(e.target, e.line); expr(e.target); return expr(e.value)
      case 'cond': expr(e.test); expr(e.cons); return expr(e.alt)
      case 'index': expr(e.target); return expr(e.index)
      case 'cast': return expr(e.arg)
      case 'list': case 'seq': e.items.forEach(expr); return
      case 'sizeof': return expr(e.arg)
      case 'call': {
        e.args.forEach(expr)
        let arity: [number, number] | null = null
        if (e.obj) {
          expr(e.index ?? null)
          if (e.obj === 'Serial' || e.obj === 'Wire') {
            arity = (e.obj === 'Serial' ? SERIAL_METHODS : WIRE_METHODS)[e.name] ?? null
            if (!arity) { report(e.line, `'${e.obj}.${e.name}()' isn't supported by the simulator`); return }
          } else {
            const info = lookup(e.obj)
            if (!info) { report(e.line, `'${e.obj}' was not declared in this scope`); return }
            if (!info.objType) { report(e.line, `request for member '${e.name}' in '${e.obj}', which is not an object`); return }
            if (info.objType !== 'Servo') return
            arity = SERVO_METHODS[e.name] ?? null
            if (!arity) { report(e.line, `'class Servo' has no member named '${e.name}'`); return }
          }
        } else if (program.fns.has(e.name)) {
          const count = program.fns.get(e.name)!.params.length
          arity = [count, count]
        } else if (e.name in BUILTIN_FUNCTIONS) {
          arity = BUILTIN_FUNCTIONS[e.name]
          if (['bitSet', 'bitClear', 'bitWrite'].includes(e.name) && e.args[0] && e.args[0].k !== 'id' && e.args[0].k !== 'index') report(e.line, `${e.name}() needs a variable as its first argument`)
          else if (['bitSet', 'bitClear', 'bitWrite'].includes(e.name) && e.args[0]) checkTarget(e.args[0], e.line)
        } else {
          report(e.line, `'${e.name}' was not declared in this scope`)
          return
        }
        const label = e.obj ? `${e.obj}.${e.name}` : e.name
        if (e.args.length < arity[0]) report(e.line, `too few arguments to function '${label}'`)
        else if (e.args.length > arity[1]) report(e.line, `too many arguments to function '${label}'`)
        return
      }
      default: return
    }
  }

  const declareVar = (s: Extract<Stmt, { k: 'var' }>) => {
    for (const decl of s.decls) {
      expr(decl.size)
      expr(decl.init)
      // Constructor arguments of library objects often use the library's own constants, so they aren't checked.
      declare(decl.name, decl.line, { isConst: s.isConst, isArray: decl.isArray, objType: s.isObject ? s.type : undefined })
    }
  }

  const stmt = (s: Stmt, inLoop: boolean, inSwitch: boolean): void => {
    switch (s.k) {
      case 'var': return declareVar(s)
      case 'expr': return expr(s.e)
      case 'if': expr(s.test); stmt(s.cons, inLoop, inSwitch); if (s.alt) stmt(s.alt, inLoop, inSwitch); return
      case 'while': expr(s.test); return stmt(s.body, true, inSwitch)
      case 'do': stmt(s.body, true, inSwitch); return expr(s.test)
      case 'for':
        scopes.push(new Map())
        if (s.init) stmt(s.init, inLoop, inSwitch)
        expr(s.test)
        expr(s.update)
        stmt(s.body, true, inSwitch)
        scopes.pop()
        return
      case 'block':
        scopes.push(new Map())
        s.body.forEach((child) => stmt(child, inLoop, inSwitch))
        scopes.pop()
        return
      case 'return': return expr(s.e)
      case 'break': if (!inLoop && !inSwitch) report(s.line, 'break statement not within loop or switch'); return
      case 'continue': if (!inLoop) report(s.line, 'continue statement not within a loop'); return
      case 'switch':
        expr(s.disc)
        scopes.push(new Map())
        for (const branch of s.cases) { expr(branch.test); branch.body.forEach((child) => stmt(child, inLoop, true)) }
        scopes.pop()
        return
      default: return
    }
  }

  for (const global of program.globals) if (global.k === 'var') declareVar(global)
  for (const fn of program.fns.values()) {
    if (fn.name in BUILTIN_FUNCTIONS) report(fn.line, `'${fn.name}()' is a built-in Arduino function and can't be redefined`)
    scopes.push(new Map())
    fn.params.forEach((param) => declare(param.name, fn.line, { isConst: false, isArray: param.isArray }))
    stmt(fn.body, false, false)
    scopes.pop()
  }
  for (const required of ['setup', 'loop']) {
    if (!program.fns.has(required)) report(1, `undefined reference to '${required}()': every sketch needs void setup() and void loop()`)
  }
  return errors.sort((a, b) => a.line - b.line)
}

// ---------------------------------------------------------------- runtime values

type Value = { t: 'i' | 'f' | 'c'; v: number } | { t: 's'; v: string }
type Slot = { type: string; isConst: boolean; value?: Value; arr?: Value[] }
type Signal = null | { s: 'break' } | { s: 'continue' } | { s: 'return'; v: Value | null }

const int = (v: number): Value => ({ t: 'i', v })
const float = (v: number): Value => ({ t: 'f', v })

function wrapInt(n: number, bits: number, signed: boolean): number {
  if (!Number.isFinite(n)) return 0
  const truncated = Math.trunc(n)
  if (bits >= 64) return truncated
  const range = 2 ** bits
  let result = ((truncated % range) + range) % range
  if (signed && result >= range / 2) result -= range
  return result
}

function typeSize(type: string): number {
  if (type === 'float' || type === 'String') return type === 'float' ? 4 : 6
  if (type === 'bool') return 1
  return INT_TYPES[type] ? INT_TYPES[type][0] / 8 : 2
}

const bin8 = (n: number) => `0b${(n & 0xff).toString(2).padStart(8, '0')}`
const hex2 = (n: number) => `0x${(n & 0xff).toString(16).toUpperCase().padStart(2, '0')}`

function formatFloat(n: number, digits: number): string {
  if (Number.isNaN(n)) return 'nan'
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf'
  return n.toFixed(digits)
}

function pinNumberLabel(pin: PinDefinition): string {
  return pin.family === 'Digital' ? pin.id.slice(1) : pin.id
}

type LibraryObject = { cls: string; name: string; pin: PinDefinition | null; us: number; min: number; max: number; attached: boolean }

function servoAngle(servo: LibraryObject): number {
  return Math.round(((servo.us - servo.min) * 180) / (servo.max - servo.min))
}

// ---------------------------------------------------------------- machine

class Machine {
  private program: Program
  private lines: string[]
  regs: Record<string, number> = { DDRB: 0, PORTB: 0, DDRC: 0, PORTC: 0, DDRD: 0, PORTD: 0, OCR0A: 0, OCR0B: 0, OCR1A: 0, OCR1B: 0, OCR2A: 0, OCR2B: 0, ADMUX: 0, UBRR0: 0, UCSR0B: 0 }
  pwm: Record<string, number> = {}
  tones: Record<string, number> = {}
  timeMs = 0
  serial = ''
  serialBaud = 0
  events: SimEvent[] = []
  warnings: Diagnostic[] = []
  loopIterations = 0
  private phase: 'setup' | 'loop' = 'setup'
  private ops = 0
  private line = 1
  private depth = 0
  private seed = 1
  private globals = new Map<string, Slot>()
  private scopes: Map<string, Slot>[] = []
  private warned = new Set<string>()
  private objects: LibraryObject[] = []
  private i2c = { begun: false, address: 0, tx: [] as number[], rx: [] as number[], pointer: {} as Record<number, number>, devices: {} as Record<number, number[]> }

  constructor(program: Program, source: string) {
    this.program = program
    this.lines = source.split(/\r?\n/)
  }

  // ---- control

  run() {
    this.scopes = [this.globals]
    for (const global of this.program.globals) this.exec(global)
    this.scopes = []
    this.callUser('setup', [], 1)
    this.phase = 'loop'
    for (let iteration = 1; iteration <= MAX_LOOP_ITERATIONS; iteration++) {
      this.loopIterations = iteration
      this.callUser('loop', [], this.program.fns.get('loop')!.line)
    }
  }

  private tick(line: number) {
    this.line = line
    this.ops++
    this.timeMs += OP_TIME_MS
    if (this.ops > MAX_OPS) throw new StopSimulation(`Stopped after ${MAX_OPS.toLocaleString('en-US')} instructions. The sketch may be stuck in a loop.`)
  }

  private warn(message: string, line = this.line) {
    if (this.warned.has(message)) return
    this.warned.add(message)
    this.warnings.push({ line, message })
  }

  private fail(message: string): never {
    throw new RuntimeError(this.line, message)
  }

  // ---- hardware model

  private pinState(pin: PinDefinition) {
    const mask = 1 << pin.bit
    const output = (this.regs[`DDR${pin.port}`] & mask) !== 0
    const portBit = (this.regs[`PORT${pin.port}`] & mask) !== 0
    return { output, portBit, level: output || portBit ? (portBit ? 1 : 0) : 0 }
  }

  private pinRegister(port: Port): number {
    // Outputs read back their driven level; inputs read HIGH only when pulled up (no external signals in the simulation),
    // so every PINx bit equals its PORTx bit.
    return this.regs[`PORT${port}`] & 0xff
  }

  private readRegister(name: string): number {
    if (name.startsWith('PIN')) return this.pinRegister(name.slice(3) as Port)
    return this.regs[name] ?? 0
  }

  snapshot(): Snapshot {
    return {
      regs: { ...this.regs, PINB: this.pinRegister('B'), PINC: this.pinRegister('C'), PIND: this.pinRegister('D') },
      pwm: { ...this.pwm },
      tones: { ...this.tones },
      servos: Object.fromEntries(this.objects.filter((object) => object.cls === 'Servo' && object.attached && object.pin).map((object) => [object.pin!.id, servoAngle(object)])),
      timeMs: this.timeMs,
    }
  }

  private emit(kind: SimEventKind, call: string, pin: PinDefinition | null, steps: TraceStep[], result: string, explanation: string, before: Snapshot) {
    this.events.push({
      index: this.events.length, kind, line: this.line, call, pin, steps, result, explanation,
      phase: this.phase, loopIteration: this.loopIterations, before, after: this.snapshot(),
    })
    if (this.events.length >= MAX_EVENTS) throw new StopSimulation(`Stopped after ${MAX_EVENTS} hardware operations.`)
  }

  private codeStep(call: string): TraceStep {
    const source = (this.lines[this.line - 1] ?? '').trim()
    return { kind: 'CODE', title: call, description: `Line ${this.line}: ${source}` }
  }

  private pinSteps(pin: PinDefinition): TraceStep[] {
    return [
      { kind: 'PIN', title: `Arduino ${pin.id}`, description: `Pin ${pinNumberLabel(pin)} is the ${pin.family.toLowerCase()} header pin ${pin.id}${pin.id === 'D13' ? ', wired to the built-in LED "L"' : ''}.` },
      { kind: 'MCU', title: `ATmega328P · ${pin.mcuPin}`, description: `${pin.id} is connected to port ${pin.port}, bit ${pin.bit} of the ATmega328P.` },
    ]
  }

  private physicalStep(pin: PinDefinition): TraceStep {
    const { output, portBit } = this.pinState(pin)
    const duty = this.pwm[pin.id]
    const tone = this.tones[pin.id]
    const servo = this.objects.find((object) => object.cls === 'Servo' && object.attached && object.pin?.id === pin.id)
    if (servo) return { kind: 'PHYSICAL', title: `Servo horn → ${servoAngle(servo)}°`, description: `The servo's control board compares the ${servo.us} µs pulse with its internal potentiometer and turns the horn to ${servoAngle(servo)}°.` }
    if (tone) return { kind: 'PHYSICAL', title: `${pin.id} → ${tone} Hz tone`, description: `A buzzer on ${pin.id} would sound at ${tone} Hz.` }
    if (duty !== undefined) {
      const percent = Math.round((duty / 255) * 100)
      return { kind: 'PHYSICAL', title: `${pin.id} → ${percent}% power`, description: `An LED on ${pin.id} glows at about ${percent}% brightness (average ${(5 * duty / 255).toFixed(2)} V).` }
    }
    if (output) {
      if (pin.id === 'D13') return { kind: 'PHYSICAL', title: `Built-in LED → ${portBit ? 'ON' : 'OFF'}`, description: `The Uno's built-in LED on D13 turns ${portBit ? 'ON' : 'OFF'}.` }
      return { kind: 'PHYSICAL', title: `${pin.id} output → ${portBit ? 'HIGH' : 'LOW'}`, description: `${pin.id} drives the connected circuit at ${portBit ? '5 V' : '0 V'}.` }
    }
    return portBit
      ? { kind: 'PHYSICAL', title: `${pin.id} held HIGH by pull-up`, description: `With nothing connected, ${pin.id} reads HIGH. A button to GND would pull it LOW.` }
      : { kind: 'PHYSICAL', title: `${pin.id} is a high-impedance input`, description: `${pin.id} draws almost no current and just senses voltage.` }
  }

  private resolvePin(raw: Value, fn: string, analogOnly = false): PinDefinition | null {
    const n = Math.trunc(this.toNumber(raw))
    if (analogOnly) {
      const channel = n >= 14 ? n - 14 : n
      const pin = pinMap.find((candidate) => candidate.id === `A${channel}`)
      if (!pin) this.warn(`${fn}(): A${channel} doesn't exist on the Uno, so the call was ignored.`)
      return pin ?? null
    }
    const pin = n >= 0 && n <= 13 ? pinMap.find((candidate) => candidate.id === `D${n}`) : n >= 14 && n <= 19 ? pinMap.find((candidate) => candidate.id === `A${n - 14}`) : undefined
    if (!pin) this.warn(`${fn}(): pin ${n} doesn't exist on the Uno, so the call was ignored.`)
    return pin ?? null
  }

  private checkSerialPins(pin: PinDefinition) {
    if (this.serialBaud && (pin.id === 'D0' || pin.id === 'D1')) this.warn(`${pin.id} is used by Serial (${pin.id === 'D0' ? 'RX' : 'TX'}) while Serial is on; using it for I/O will clash with serial data.`)
  }

  private stopPwm(pin: PinDefinition) {
    delete this.pwm[pin.id]
    delete this.tones[pin.id]
  }

  private hwPinMode(args: Value[]) {
    const pin = this.resolvePin(args[0], 'pinMode')
    if (!pin) return
    this.checkSerialPins(pin)
    const modeValue = Math.trunc(this.toNumber(args[1]))
    const mode = (['INPUT', 'OUTPUT', 'INPUT_PULLUP'] as const)[modeValue]
    if (!mode) { this.warn(`pinMode(): ${modeValue} isn't a valid mode (use INPUT, OUTPUT or INPUT_PULLUP).`); return }
    const before = this.snapshot()
    const ddr = `DDR${pin.port}`
    const port = `PORT${pin.port}`
    const mask = 1 << pin.bit
    const ddrOld = this.regs[ddr]
    const portOld = this.regs[port]
    if (mode === 'OUTPUT') this.regs[ddr] |= mask
    else {
      this.regs[ddr] &= ~mask & 0xff
      if (mode === 'INPUT_PULLUP') this.regs[port] |= mask
      else this.regs[port] &= ~mask & 0xff
    }
    const portBit = (this.regs[port] & mask) ? 1 : 0
    const call = `pinMode(${pinNumberLabel(pin)}, ${mode})`
    const signal = mode === 'OUTPUT' ? `${pin.mcuPin} = ${portBit ? 'HIGH' : 'LOW'} (driven)` : mode === 'INPUT_PULLUP' ? `${pin.mcuPin} = HIGH (pull-up)` : `${pin.mcuPin} = Hi-Z input`
    this.emit('pinMode', call, pin, [
      this.codeStep(call),
      ...this.pinSteps(pin),
      { kind: 'REGISTER', title: `DDR${pin.port} · bit ${pin.bit} → ${mode === 'OUTPUT' ? 1 : 0}`, description: `DDR${pin.port} ${bin8(ddrOld)} → ${bin8(this.regs[ddr])}: ${pin.mcuPin} becomes an ${mode === 'OUTPUT' ? 'output' : 'input'}.` },
      { kind: 'REGISTER', title: `PORT${pin.port} · bit ${pin.bit} → ${portBit}`, description: mode === 'OUTPUT'
        ? `PORT${pin.port} bit ${pin.bit} stays ${portBit}, so the pin starts ${portBit ? 'HIGH' : 'LOW'}.`
        : mode === 'INPUT_PULLUP'
          ? `PORT${pin.port} ${bin8(portOld)} → ${bin8(this.regs[port])}: on an input, a 1 here switches on the internal ~35 kΩ pull-up.`
          : `PORT${pin.port} bit ${pin.bit} is 0: no pull-up, so the pin floats.` },
      { kind: 'SIGNAL', title: signal, description: mode === 'OUTPUT' ? `The pin driver is enabled and pushes ${portBit ? '5 V' : '0 V'} onto ${pin.mcuPin}.` : `The output driver is off; ${pin.mcuPin} only senses the voltage on it.` },
      this.physicalStep(pin),
    ], `${pin.id} → ${mode}`, `pinMode() sets bit ${pin.bit} of DDR${pin.port}: 1 makes ${pin.mcuPin} an output, 0 makes it an input.${mode === 'INPUT_PULLUP' ? ` It also sets PORT${pin.port} bit ${pin.bit} to enable the internal pull-up.` : ''}`, before)
  }

  private hwDigitalWrite(args: Value[]) {
    const pin = this.resolvePin(args[0], 'digitalWrite')
    if (!pin) return
    this.checkSerialPins(pin)
    const level = this.toNumber(args[1]) ? 1 : 0
    const before = this.snapshot()
    const hadPwm = this.pwm[pin.id] !== undefined || this.tones[pin.id] !== undefined
    this.stopPwm(pin)
    const port = `PORT${pin.port}`
    const mask = 1 << pin.bit
    const portOld = this.regs[port]
    if (level) this.regs[port] |= mask
    else this.regs[port] &= ~mask & 0xff
    const { output } = this.pinState(pin)
    if (!output) this.warn(`digitalWrite(${pinNumberLabel(pin)}, …): ${pin.id} isn't set as OUTPUT, so this only switches its pull-up. Add pinMode(${pinNumberLabel(pin)}, OUTPUT) in setup().`)
    const levelName: PinLevel = level ? 'HIGH' : 'LOW'
    const call = `digitalWrite(${pinNumberLabel(pin)}, ${levelName})`
    this.emit('digitalWrite', call, pin, [
      this.codeStep(call),
      ...this.pinSteps(pin),
      { kind: 'REGISTER', title: `DDR${pin.port} · bit ${pin.bit} = ${output ? 1 : 0}`, description: output ? `${pin.mcuPin} is already an output, so PORT${pin.port} controls its voltage.` : `${pin.mcuPin} is still an INPUT, so PORT${pin.port} only switches its pull-up resistor.` },
      { kind: 'REGISTER', title: `PORT${pin.port} · bit ${pin.bit} → ${level}`, description: `PORT${pin.port} ${bin8(portOld)} → ${bin8(this.regs[port])}.${hadPwm ? ' PWM on this pin is switched off first.' : ''}` },
      { kind: 'SIGNAL', title: output ? `${pin.mcuPin} = ${levelName} (${level ? '5 V' : '0 V'})` : `${pin.mcuPin} pull-up ${level ? 'ON' : 'OFF'}`, description: output ? `The output driver connects ${pin.mcuPin} to ${level ? 'VCC' : 'GND'}.` : 'The pin is not driven; only the weak pull-up changes.' },
      this.physicalStep(pin),
    ], pin.id === 'D13' && output ? `LED ${level ? 'ON' : 'OFF'}` : `${pin.id} → ${levelName}`, `digitalWrite() finds ${pin.id} = ${pin.mcuPin} and sets PORT${pin.port} bit ${pin.bit} to ${level}. Because DDR${pin.port} bit ${pin.bit} is ${output ? '1 (output)' : '0 (input)'}, ${output ? `the pin is driven ${levelName}` : 'only the pull-up changes'}.`, before)
  }

  private hwDigitalRead(args: Value[]): Value {
    const pin = this.resolvePin(args[0], 'digitalRead')
    if (!pin) return int(0)
    const before = this.snapshot()
    const { output, portBit } = this.pinState(pin)
    const value = (this.pinRegister(pin.port) >> pin.bit) & 1
    const levelName = value ? 'HIGH' : 'LOW'
    const call = `digitalRead(${pinNumberLabel(pin)})`
    this.emit('digitalRead', call, pin, [
      this.codeStep(call),
      ...this.pinSteps(pin),
      { kind: 'REGISTER', title: `DDR${pin.port} · bit ${pin.bit} = ${output ? 1 : 0}`, description: output ? `${pin.mcuPin} is an output, so reading it returns the level it's driving.` : `${pin.mcuPin} is an input, so the MCU samples the voltage on the pin.` },
      { kind: 'REGISTER', title: `PIN${pin.port} · bit ${pin.bit} = ${value}`, description: `PIN${pin.port} reads ${bin8(this.pinRegister(pin.port))}; bit ${pin.bit} is ${value}.` },
      { kind: 'SIGNAL', title: `${pin.mcuPin} = ${levelName}`, description: output ? `Driven ${levelName} by PORT${pin.port}.` : portBit ? 'The internal pull-up holds the pin HIGH (no button pressed in the simulation).' : 'Nothing is connected in the simulation, so the input reads LOW.' },
      { kind: 'VALUE', title: `digitalRead() returns ${levelName} (${value})`, description: 'Your code receives this value and can make decisions with it.' },
    ], `read ${levelName}`, `digitalRead() looks up ${pin.id} = ${pin.mcuPin} and returns bit ${pin.bit} of the PIN${pin.port} input register.`, before)
    return int(value)
  }

  private hwAnalogWrite(args: Value[]) {
    const pin = this.resolvePin(args[0], 'analogWrite')
    if (!pin) return
    const duty = Math.max(0, Math.min(255, Math.trunc(this.toNumber(args[1]))))
    const before = this.snapshot()
    const ddr = `DDR${pin.port}`
    const port = `PORT${pin.port}`
    const mask = 1 << pin.bit
    this.regs[ddr] |= mask
    const timer = PWM_TIMERS[pin.id]
    this.stopPwm(pin)
    const call = `analogWrite(${pinNumberLabel(pin)}, ${duty})`
    const steps: TraceStep[] = [
      this.codeStep(call),
      ...this.pinSteps(pin),
      { kind: 'REGISTER', title: `DDR${pin.port} · bit ${pin.bit} → 1`, description: `analogWrite() makes ${pin.mcuPin} an output automatically.` },
    ]
    let result: string
    let explanation: string
    if (duty === 0 || duty === 255 || !timer) {
      const level = timer ? (duty === 255 ? 1 : 0) : (duty < 128 ? 0 : 1)
      if (!timer) this.warn(`analogWrite(${pinNumberLabel(pin)}, …): ${pin.id} has no PWM, so it is written ${level ? 'HIGH' : 'LOW'} instead. PWM pins are 3, 5, 6, 9, 10 and 11.`)
      if (level) this.regs[port] |= mask
      else this.regs[port] &= ~mask & 0xff
      steps.push(
        { kind: 'REGISTER', title: `PORT${pin.port} · bit ${pin.bit} → ${level}`, description: timer ? `A value of ${duty} is a plain digital ${level ? 'HIGH' : 'LOW'}: the timer is disconnected.` : `${pin.id} has no timer output, so the value is rounded to ${level ? 'HIGH' : 'LOW'}.` },
        { kind: 'SIGNAL', title: `${pin.mcuPin} = ${level ? 'HIGH' : 'LOW'}`, description: `A steady ${level ? '5 V' : '0 V'}.` },
      )
      result = `${pin.id} → ${level ? 'HIGH' : 'LOW'}`
      explanation = `analogWrite(${duty}) on ${pin.id} acts as a digital write, setting PORT${pin.port} bit ${pin.bit}.`
    } else {
      this.regs[timer.ocr] = duty
      this.pwm[pin.id] = duty
      const percent = Math.round((duty / 255) * 100)
      steps.push(
        { kind: 'TIMER', title: `Timer${timer.timer} · ${timer.ocr} ← ${duty}`, description: `Timer${timer.timer} counts 0–255 over and over. ${pin.mcuPin} stays HIGH while the count is below ${timer.ocr} = ${duty}.` },
        { kind: 'SIGNAL', title: `${pin.mcuPin} = PWM ${percent}% @ ${timer.hz} Hz`, description: `The pin switches rapidly; its average voltage is ≈ ${(5 * duty / 255).toFixed(2)} V.` },
      )
      result = `${pin.id} → PWM ${percent}%`
      explanation = `analogWrite() loads ${duty} into ${timer.ocr}. Timer${timer.timer} compares its counter with it and toggles ${pin.mcuPin}, giving a ${percent}% duty cycle at ${timer.hz} Hz.`
    }
    steps.push(this.physicalStep(pin))
    this.emit('analogWrite', call, pin, steps, result, explanation, before)
  }

  private hwAnalogRead(args: Value[]): Value {
    const pin = this.resolvePin(args[0], 'analogRead', true)
    if (!pin) return int(0)
    const before = this.snapshot()
    const { output, portBit } = this.pinState(pin)
    const value = output ? (portBit ? 1023 : 0) : portBit ? 1023 : 512
    const volts = ((value * 5) / 1023).toFixed(2)
    this.regs.ADMUX = 0x40 | pin.bit
    this.timeMs += 0.104
    const call = `analogRead(${pin.id})`
    this.emit('analogRead', call, pin, [
      this.codeStep(call),
      { kind: 'PIN', title: `Arduino ${pin.id}`, description: `${pin.id} is analog input channel ${pin.bit}.` },
      { kind: 'MCU', title: `ATmega328P · ${pin.mcuPin} (ADC${pin.bit})`, description: `${pin.id} is connected to ${pin.mcuPin}, which feeds the ADC multiplexer.` },
      { kind: 'REGISTER', title: `ADMUX ← ${hex2(this.regs.ADMUX)}`, description: `Selects the AVcc (5 V) reference and channel ADC${pin.bit}.` },
      { kind: 'REGISTER', title: 'ADCSRA · ADSC → 1', description: 'Starts a 10-bit conversion, which takes about 104 µs.' },
      { kind: 'SIGNAL', title: `${pin.mcuPin} ≈ ${volts} V`, description: value === 512 ? 'No sensor in the simulation, so the input sits at mid-scale (2.5 V).' : `The pin is ${output ? 'driven' : 'pulled up'} to ${value ? '5 V' : '0 V'}.` },
      { kind: 'VALUE', title: `analogRead() returns ${value}`, description: `${volts} V × 1023 / 5 V ≈ ${value}, read from ADCL/ADCH.` },
    ], `read ${value}`, `analogRead() points the ADC multiplexer (ADMUX) at ${pin.mcuPin}, starts a conversion and returns a 0–1023 result.`, before)
    return int(value)
  }

  private hwDelay(ms: number, micro: boolean) {
    const amount = Math.max(0, this.toNumber(int(ms)))
    const before = this.snapshot()
    this.timeMs += micro ? amount / 1000 : amount
    const call = micro ? `delayMicroseconds(${amount})` : `delay(${amount})`
    this.emit('delay', call, null, [
      this.codeStep(call),
      { kind: 'TIMER', title: micro ? 'Busy-wait loop' : 'Timer0 → millis()', description: micro ? `The CPU spins for ${amount} µs (16 cycles per µs).` : `Timer0 overflows every 1.024 ms and advances millis(); delay() waits until ${amount} ms have passed.` },
      { kind: 'VALUE', title: `t = ${this.formatTime(this.timeMs)}`, description: 'Pins keep their current state while the CPU waits.' },
    ], `wait ${micro ? `${amount} µs` : `${amount} ms`}`, `${micro ? 'delayMicroseconds' : 'delay'}() pauses the program. Every output keeps its level, so whatever you just set stays visible for that long.`, before)
    if (this.timeMs > MAX_TIME_MS) throw new StopSimulation(`Stopped after ${MAX_TIME_MS / 1000} s of simulated time.`)
  }

  private formatTime(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 3)} s` : `${Math.round(ms * 1000) / 1000} ms`
  }

  private hwSerialBegin(args: Value[]) {
    const baud = Math.trunc(this.toNumber(args[0]))
    if (baud <= 0) this.fail(`Serial.begin(): invalid baud rate ${baud}`)
    const before = this.snapshot()
    this.serialBaud = baud
    const ubrr = Math.floor((Math.floor(16_000_000 / 4 / baud) - 1) / 2)
    this.regs.UBRR0 = ubrr
    this.regs.UCSR0B = 0x98
    const actual = Math.round(16_000_000 / (8 * (ubrr + 1)))
    const tx = pinMap.find((pin) => pin.id === 'D1')!
    const call = `Serial.begin(${baud})`
    this.emit('serial', call, tx, [
      this.codeStep(call),
      { kind: 'REGISTER', title: `UBRR0 ← ${ubrr}`, description: `Baud divider: 16 MHz / (8 × (${ubrr} + 1)) ≈ ${actual} baud.` },
      { kind: 'REGISTER', title: 'UCSR0B ← 0x98', description: 'Enables the USART0 transmitter and receiver (TXEN0, RXEN0, RXCIE0).' },
      { kind: 'PIN', title: 'D0 / D1 → RX / TX', description: 'While Serial is on, D0 and D1 belong to the USART. Avoid using them for digital I/O.' },
      { kind: 'PHYSICAL', title: `USB serial link @ ${baud} baud`, description: 'The USB-serial chip on the Uno connects TX/RX to your computer.' },
    ], `Serial @ ${baud}`, `Serial.begin() programs the USART0 baud-rate register UBRR0 and enables transmit/receive on D1/D0.`, before)
  }

  private hwSerialWrite(text: string, call: string) {
    if (!this.serialBaud) this.warn('Serial output used before Serial.begin(): nothing would appear on a real board.')
    const before = this.snapshot()
    this.serial += text
    const bytes = text.length
    const baud = this.serialBaud || 9600
    const ms = (bytes * 10 * 1000) / baud
    const preview = JSON.stringify(text.length > 24 ? `${text.slice(0, 24)}…` : text)
    const tx = pinMap.find((pin) => pin.id === 'D1')!
    this.emit('serial', call, tx, [
      this.codeStep(call),
      { kind: 'REGISTER', title: `UDR0 ← ${preview}`, description: `Each of the ${bytes} byte${bytes === 1 ? '' : 's'} is written to the USART data register UDR0.` },
      { kind: 'PIN', title: 'D1 (TX) · PD1', description: `The USART shifts the bits out on PD1 at ${baud} baud (≈ ${ms.toFixed(1)} ms for this message).` },
      { kind: 'PHYSICAL', title: `Serial Monitor ← ${preview}`, description: 'The USB-serial chip forwards the bytes to the Serial Monitor on your computer.' },
    ], `TX ${preview}`, `Serial printing writes bytes into UDR0; the USART sends them bit by bit on D1 (TX).`, before)
  }

  private hwTone(args: Value[]) {
    const pin = this.resolvePin(args[0], 'tone')
    if (!pin) return
    const freq = Math.max(31, Math.trunc(this.toNumber(args[1])))
    const before = this.snapshot()
    this.regs[`DDR${pin.port}`] |= 1 << pin.bit
    let prescaler = 1
    let ocr = 0
    for (const candidate of [1, 8, 32, 64, 128, 256, 1024]) {
      prescaler = candidate
      ocr = Math.round(16_000_000 / (2 * candidate * freq)) - 1
      if (ocr <= 255) break
    }
    this.regs.OCR2A = Math.max(0, Math.min(255, ocr))
    this.stopPwm(pin)
    this.tones[pin.id] = freq
    const call = `tone(${pinNumberLabel(pin)}, ${freq}${args[2] ? `, ${Math.trunc(this.toNumber(args[2]))}` : ''})`
    this.emit('tone', call, pin, [
      this.codeStep(call),
      ...this.pinSteps(pin),
      { kind: 'REGISTER', title: `DDR${pin.port} · bit ${pin.bit} → 1`, description: `tone() makes ${pin.mcuPin} an output.` },
      { kind: 'TIMER', title: `Timer2 · OCR2A ← ${this.regs.OCR2A}`, description: `Timer2 (prescaler ${prescaler}) interrupts at ${freq * 2} Hz and toggles ${pin.mcuPin} each time.` },
      { kind: 'SIGNAL', title: `${pin.mcuPin} = ${freq} Hz square wave`, description: 'A 50% duty cycle square wave.' },
      this.physicalStep(pin),
    ], `${pin.id} → ${freq} Hz`, `tone() uses Timer2 to toggle ${pin.mcuPin} ${freq * 2} times a second, producing a ${freq} Hz square wave.`, before)
  }

  private hwNoTone(args: Value[]) {
    const pin = this.resolvePin(args[0], 'noTone')
    if (!pin) return
    const before = this.snapshot()
    this.stopPwm(pin)
    this.regs[`PORT${pin.port}`] &= ~(1 << pin.bit) & 0xff
    const call = `noTone(${pinNumberLabel(pin)})`
    this.emit('tone', call, pin, [
      this.codeStep(call),
      ...this.pinSteps(pin),
      { kind: 'TIMER', title: 'Timer2 interrupt → off', description: 'Timer2 stops toggling the pin.' },
      { kind: 'REGISTER', title: `PORT${pin.port} · bit ${pin.bit} → 0`, description: `${pin.mcuPin} is left LOW.` },
      this.physicalStep(pin),
    ], `${pin.id} silent`, 'noTone() stops the Timer2 interrupt and leaves the pin LOW.', before)
  }

  private writeRegister(name: string, value: number, call: string) {
    const before = this.snapshot()
    const port = name.slice(-1) as Port
    const isPin = name.startsWith('PIN')
    const target = isPin ? `PORT${port}` : name
    const old = this.regs[target]
    // Writing 1s to PINx toggles the matching PORTx bits (an AVR hardware feature).
    this.regs[target] = (isPin ? old ^ value : value) & 0xff
    const changed = old ^ this.regs[target]
    const bits = [0, 1, 2, 3, 4, 5, 6, 7].filter((bit) => changed & (1 << bit))
    const pins = bits.map((bit) => pinMap.find((pin) => pin.port === port && pin.bit === bit)).filter((pin): pin is PinDefinition => Boolean(pin))
    const focus = pins[0] ?? null
    const steps: TraceStep[] = [
      this.codeStep(call),
      { kind: 'REGISTER', title: `${target} ${hex2(old)} → ${hex2(this.regs[target])}`, description: `${bin8(old)} → ${bin8(this.regs[target])}${isPin ? ` (writing ${bin8(value)} to ${name} toggles those bits)` : ''}. ${bits.length ? `Bit${bits.length > 1 ? 's' : ''} ${bits.join(', ')} changed.` : 'No bits changed.'}` },
    ]
    for (const pin of pins.slice(0, 3)) {
      const set = (this.regs[target] >> pin.bit) & 1
      steps.push({ kind: 'MCU', title: `${pin.mcuPin} (${pin.id}) → ${target.startsWith('DDR') ? (set ? 'output' : 'input') : set ? 'HIGH' : 'LOW'}`, description: `Bit ${pin.bit} of ${target} controls ${pin.mcuPin}, which is Arduino ${pin.id}.` })
    }
    if (focus) steps.push(this.physicalStep(focus))
    this.emit('register', call, focus, steps, `${target} = ${hex2(this.regs[target])}`, `Writing ${target} directly changes all eight pins of port ${port} in one instruction. This is what pinMode() and digitalWrite() do internally, one bit at a time.`, before)
  }

  // ---- variables

  private findSlot(name: string): Slot | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) { const slot = this.scopes[i].get(name); if (slot) return slot }
    return this.globals.get(name) ?? null
  }

  private declare(name: string, slot: Slot) {
    (this.scopes[this.scopes.length - 1] ?? this.globals).set(name, slot)
  }

  private declareObject(cls: string, decl: Declarator) {
    if (cls !== 'Servo') this.warn(`'${cls}' comes from a library that isn't simulated, so calls on '${decl.name}' are skipped.`)
    const make = (name: string): Value => {
      this.objects.push({ cls, name, pin: null, us: 1500, min: 544, max: 2400, attached: false })
      return int(this.objects.length - 1)
    }
    if (!decl.isArray) { this.declare(decl.name, { type: cls, isConst: true, value: make(decl.name) }); return }
    const size = Math.trunc(this.toNumber(this.eval(decl.size!)))
    if (size <= 0 || size > 32) this.fail(`object array '${decl.name}' has an invalid size (${size})`)
    this.declare(decl.name, { type: cls, isConst: true, arr: Array.from({ length: size }, (_, i) => make(`${decl.name}[${i}]`)) })
  }

  coerce(type: string, value: Value): Value {
    if (type === 'auto') return value
    if (type !== 'String' && type !== 'float' && type !== 'bool' && !INT_TYPES[type] && !TYPE_WORDS.has(type)) return value
    if (type === 'String') return { t: 's', v: this.toText(value) }
    if (value.t === 's') this.fail(`cannot convert text to '${type}'`)
    const n = value.v
    if (type === 'float') return float(n)
    if (type === 'bool') return int(n ? 1 : 0)
    const width = INT_TYPES[type]
    if (!width) return int(Math.trunc(n))
    const wrapped = wrapInt(n, width[0], width[1])
    return type === 'char' ? { t: 'c', v: wrapped } : int(wrapped)
  }

  private toNumber(value: Value): number {
    if (value.t === 's') this.fail('expected a number but got text')
    return value.v
  }

  private toText(value: Value, base = 10, digits = 2): string {
    if (value.t === 's') return value.v
    if (value.t === 'c') return String.fromCharCode(value.v & 0xff)
    if (value.t === 'f') return formatFloat(value.v, digits)
    if (base !== 10) return (value.v < 0 ? value.v >>> 0 : value.v).toString(base).toUpperCase()
    return String(value.v)
  }

  private readVar(e: Extract<Expr, { k: 'id' }>): Value {
    const slot = this.findSlot(e.name)
    if (slot) {
      if (slot.arr) this.fail(`'${e.name}' is an array; use ${e.name}[index]`)
      return slot.value!
    }
    if (PORT_REGISTERS.includes(e.name)) return int(this.readRegister(e.name))
    if (e.name in FLOAT_CONSTANTS) return float(FLOAT_CONSTANTS[e.name])
    return int(BUILTIN_CONSTANTS[e.name] ?? 0)
  }

  private getTarget(target: Expr): Value {
    return this.eval(target)
  }

  private setTarget(target: Expr, value: Value, label: () => string): Value {
    if (target.k === 'id') {
      const slot = this.findSlot(target.name)
      if (slot) {
        slot.value = this.coerce(slot.type, value)
        return slot.value
      }
      if (PORT_REGISTERS.includes(target.name)) {
        const n = wrapInt(this.toNumber(value), 8, false)
        this.writeRegister(target.name, n, label())
        return int(n)
      }
      return this.fail(`'${target.name}' cannot be assigned`)
    }
    if (target.k === 'index') {
      const { slot, index, name } = this.arrayAccess(target)
      if (slot.isConst) this.fail(`assignment of read-only array '${name}'`)
      slot.arr![index] = this.coerce(slot.type, value)
      return slot.arr![index]
    }
    return this.fail('lvalue required')
  }

  private arrayAccess(e: Extract<Expr, { k: 'index' }>): { slot: Slot; index: number; name: string } {
    if (e.target.k !== 'id') this.fail('only named arrays can be indexed')
    const name = e.target.name
    const slot = this.findSlot(name)
    const index = Math.trunc(this.toNumber(this.eval(e.index)))
    if (!slot) this.fail(`'${name}' is not an array`)
    if (!slot.arr) {
      if (slot.value?.t === 's') this.fail(`changing single characters of String '${name}' isn't supported`)
      this.fail(`'${name}' is not an array`)
    }
    if (index < 0 || index >= slot.arr.length) this.fail(`index ${index} is outside array '${name}' (size ${slot.arr.length}); on a real board this corrupts memory`)
    return { slot, index, name }
  }

  // ---- statements

  private exec(s: Stmt): Signal {
    this.tick(s.line)
    switch (s.k) {
      case 'var':
        for (const decl of s.decls) {
          this.line = decl.line
          if (s.isObject) { this.declareObject(s.type, decl); continue }
          if (decl.isArray) {
            if (decl.init?.k === 'str') { this.declare(decl.name, { type: 'String', isConst: s.isConst, value: { t: 's', v: decl.init.v } }); continue }
            const items = decl.init?.k === 'list' ? decl.init.items.map((item) => this.coerce(s.type, this.eval(item))) : []
            if (decl.init && decl.init.k !== 'list') this.fail(`array '${decl.name}' must be initialised with { … }`)
            const size = decl.size ? Math.trunc(this.toNumber(this.eval(decl.size))) : items.length
            if (size <= 0 || size > 512) this.fail(`array '${decl.name}' has an invalid size (${size}); the Uno only has 2 KB of RAM`)
            if (items.length > size) this.fail(`too many initializers for '${decl.name}[${size}]'`)
            const zero = this.coerce(s.type === 'String' ? 'String' : s.type, s.type === 'String' ? { t: 's', v: '' } : int(0))
            this.declare(decl.name, { type: s.type, isConst: s.isConst, arr: Array.from({ length: size }, (_, i) => items[i] ?? zero) })
          } else {
            if (decl.init?.k === 'list') this.fail(`'${decl.name}' is not an array`)
            const initial = decl.init ? this.eval(decl.init) : s.type === 'String' ? { t: 's' as const, v: '' } : int(0)
            this.declare(decl.name, { type: s.type, isConst: s.isConst, value: this.coerce(s.type, initial) })
          }
        }
        return null
      case 'expr': this.eval(s.e); return null
      case 'if': return this.truthy(this.eval(s.test)) ? this.exec(s.cons) : s.alt ? this.exec(s.alt) : null
      case 'while':
        while (this.truthy(this.eval(s.test))) {
          const signal = this.exec(s.body)
          if (signal?.s === 'break') break
          if (signal?.s === 'return') return signal
        }
        return null
      case 'do':
        do {
          const signal = this.exec(s.body)
          if (signal?.s === 'break') break
          if (signal?.s === 'return') return signal
        } while (this.truthy(this.eval(s.test)))
        return null
      case 'for': {
        this.scopes.push(new Map())
        try {
          if (s.init) this.exec(s.init)
          while (!s.test || this.truthy(this.eval(s.test))) {
            const signal = this.exec(s.body)
            if (signal?.s === 'break') break
            if (signal?.s === 'return') return signal
            if (s.update) this.eval(s.update)
          }
        } finally {
          this.scopes.pop()
        }
        return null
      }
      case 'block': {
        this.scopes.push(new Map())
        try {
          for (const child of s.body) {
            const signal = this.exec(child)
            if (signal) return signal
          }
        } finally {
          this.scopes.pop()
        }
        return null
      }
      case 'return': return { s: 'return', v: s.e ? this.eval(s.e) : null }
      case 'break': return { s: 'break' }
      case 'continue': return { s: 'continue' }
      case 'empty': return null
      case 'switch': {
        const disc = this.toNumber(this.eval(s.disc))
        let start = s.cases.findIndex((branch) => branch.test && this.toNumber(this.eval(branch.test)) === disc)
        if (start < 0) start = s.cases.findIndex((branch) => !branch.test)
        if (start < 0) return null
        this.scopes.push(new Map())
        try {
          for (const branch of s.cases.slice(start)) {
            for (const child of branch.body) {
              const signal = this.exec(child)
              if (signal?.s === 'break') return null
              if (signal) return signal
            }
          }
        } finally {
          this.scopes.pop()
        }
        return null
      }
    }
  }

  private truthy(value: Value): boolean {
    return value.t === 's' ? value.v.length > 0 : value.v !== 0
  }

  // ---- expressions

  private eval(e: Expr): Value {
    this.tick(e.line)
    switch (e.k) {
      case 'num': return e.float ? float(e.v) : int(e.v)
      case 'str': return { t: 's', v: e.v }
      case 'chr': return { t: 'c', v: e.v }
      case 'id': return this.readVar(e)
      case 'unary': {
        const value = this.eval(e.arg)
        if (e.op === '!') return int(this.truthy(value) ? 0 : 1)
        const n = this.toNumber(value)
        if (e.op === '-') return value.t === 'f' ? float(-n) : int(-n)
        if (e.op === '~') return int(~n)
        return value.t === 'c' ? int(n) : value
      }
      case 'update': {
        const old = this.getTarget(e.target)
        const n = this.toNumber(old)
        const next = old.t === 'f' ? float(e.op === '++' ? n + 1 : n - 1) : int(e.op === '++' ? n + 1 : n - 1)
        const name = e.target.k === 'id' ? e.target.name : 'value'
        const stored = this.setTarget(e.target, next, () => (e.prefix ? `${e.op}${name}` : `${name}${e.op}`))
        return e.prefix ? stored : old
      }
      case 'bin': {
        if (e.op === '&&') return int(this.truthy(this.eval(e.l)) && this.truthy(this.eval(e.r)) ? 1 : 0)
        if (e.op === '||') return int(this.truthy(this.eval(e.l)) || this.truthy(this.eval(e.r)) ? 1 : 0)
        return this.binary(e.op, this.eval(e.l), this.eval(e.r))
      }
      case 'assign': {
        const value = this.eval(e.value)
        const next = e.op === '=' ? value : this.binary(e.op.slice(0, -1), this.getTarget(e.target), value)
        const name = e.target.k === 'id' ? e.target.name : 'value'
        return this.setTarget(e.target, next, () => `${name} ${e.op} ${value.t === 's' ? JSON.stringify(value.v) : hex2(Math.trunc(value.v))}`)
      }
      case 'cond': return this.truthy(this.eval(e.test)) ? this.eval(e.cons) : this.eval(e.alt)
      case 'index': {
        if (e.target.k === 'id') {
          const slot = this.findSlot(e.target.name)
          if (slot?.value?.t === 's') {
            const index = Math.trunc(this.toNumber(this.eval(e.index)))
            return { t: 'c', v: slot.value.v.charCodeAt(index) || 0 }
          }
        }
        const { slot, index } = this.arrayAccess(e)
        return slot.arr![index]
      }
      case 'cast': return this.coerce(e.type, this.eval(e.arg))
      case 'list': return this.fail('a { … } list can only be used to initialise an array')
      case 'seq': {
        let last: Value = int(0)
        for (const item of e.items) last = this.eval(item)
        return last
      }
      case 'call': return this.call(e)
      case 'sizeof': {
        if (e.type) return int(typeSize(e.type))
        const arg = e.arg!
        const base = arg.k === 'index' ? arg.target : arg
        const slot = base.k === 'id' ? this.findSlot(base.name) : null
        if (slot?.arr && arg.k === 'id') return int(slot.arr.length * typeSize(slot.type))
        if (slot) return int(slot.value?.t === 's' ? slot.value.v.length + 1 : typeSize(slot.type))
        const value = this.eval(arg)
        return int(value.t === 'f' ? 4 : value.t === 'c' ? 1 : value.t === 's' ? value.v.length + 1 : 2)
      }
    }
  }

  private binary(op: string, a: Value, b: Value): Value {
    if (op === '+' && (a.t === 's' || b.t === 's')) return { t: 's', v: this.toText(a) + this.toText(b) }
    if ((op === '==' || op === '!=') && a.t === 's' && b.t === 's') return int((a.v === b.v) === (op === '==') ? 1 : 0)
    const x = this.toNumber(a)
    const y = this.toNumber(b)
    const isFloat = a.t === 'f' || b.t === 'f'
    const num = (n: number) => (isFloat ? float(n) : int(n))
    switch (op) {
      case '+': return num(x + y)
      case '-': return num(x - y)
      case '*': return num(x * y)
      case '/':
        if (isFloat) return float(x / y)
        if (y === 0) this.fail('integer division by zero')
        return int(Math.trunc(x / y))
      case '%':
        if (isFloat) this.fail("invalid operands to '%': both sides must be integers")
        if (y === 0) this.fail('integer modulo by zero')
        return int(x % y)
      case '<<': return int(Number(BigInt.asIntN(64, BigInt(Math.trunc(x)) << BigInt(Math.trunc(y) & 63))))
      case '>>': return int(Number(BigInt(Math.trunc(x)) >> BigInt(Math.trunc(y) & 63)))
      case '&': return int(Number(BigInt(Math.trunc(x)) & BigInt(Math.trunc(y))))
      case '|': return int(Number(BigInt(Math.trunc(x)) | BigInt(Math.trunc(y))))
      case '^': return int(Number(BigInt(Math.trunc(x)) ^ BigInt(Math.trunc(y))))
      case '==': return int(x === y ? 1 : 0)
      case '!=': return int(x !== y ? 1 : 0)
      case '<': return int(x < y ? 1 : 0)
      case '>': return int(x > y ? 1 : 0)
      case '<=': return int(x <= y ? 1 : 0)
      case '>=': return int(x >= y ? 1 : 0)
    }
    return this.fail(`unsupported operator '${op}'`)
  }

  private random(): number {
    // Deterministic xorshift so every run of the same sketch gives the same trace.
    let x = this.seed || 1
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    this.seed = x >>> 0
    return this.seed / 4294967296
  }

  private call(e: Extract<Expr, { k: 'call' }>): Value {
    if (e.obj === 'Serial') return this.callSerial(e)
    if (e.obj === 'Wire') return this.callWire(e)
    if (e.obj) return this.callObject(e)
    if (this.program.fns.has(e.name)) return this.callUser(e.name, e.args, e.line)
    if (['bitSet', 'bitClear', 'bitWrite'].includes(e.name)) {
      const current = Math.trunc(this.toNumber(this.getTarget(e.args[0])))
      const bitIndex = Math.trunc(this.toNumber(this.eval(e.args[1])))
      const on = e.name === 'bitSet' || (e.name === 'bitWrite' && this.truthy(this.eval(e.args[2])))
      const next = on ? current | (1 << bitIndex) : current & ~(1 << bitIndex)
      const name = e.args[0].k === 'id' ? e.args[0].name : 'value'
      return this.setTarget(e.args[0], int(next), () => `${e.name}(${name}, ${bitIndex}${e.name === 'bitWrite' ? `, ${on ? 1 : 0}` : ''})`)
    }
    const args = e.args.map((arg) => this.eval(arg))
    const n = (i: number) => this.toNumber(args[i])
    this.line = e.line
    switch (e.name) {
      case 'pinMode': this.hwPinMode(args); return int(0)
      case 'digitalWrite': this.hwDigitalWrite(args); return int(0)
      case 'digitalRead': return this.hwDigitalRead(args)
      case 'analogWrite': this.hwAnalogWrite(args); return int(0)
      case 'analogRead': return this.hwAnalogRead(args)
      case 'analogReference': return int(0)
      case 'delay': this.hwDelay(Math.trunc(n(0)), false); return int(0)
      case 'delayMicroseconds': this.hwDelay(Math.trunc(n(0)), true); return int(0)
      case 'millis': return int(Math.floor(this.timeMs))
      case 'micros': return int(Math.floor(this.timeMs * 1000))
      case 'tone': this.hwTone(args); return int(0)
      case 'pulseIn':
      case 'pulseInLong': return this.hwPulseIn(args)
      case 'noTone': this.hwNoTone(args); return int(0)
      case 'map': {
        if (n(2) === n(1)) this.fail('map(): fromLow and fromHigh are equal (division by zero)')
        return int(Math.trunc(((n(0) - n(1)) * (n(4) - n(3))) / (n(2) - n(1)) + n(3)))
      }
      case 'constrain': { const v = Math.min(Math.max(n(0), n(1)), n(2)); return args.some((a) => a.t === 'f') ? float(v) : int(v) }
      case 'min': return args.some((a) => a.t === 'f') ? float(Math.min(n(0), n(1))) : int(Math.min(n(0), n(1)))
      case 'max': return args.some((a) => a.t === 'f') ? float(Math.max(n(0), n(1))) : int(Math.max(n(0), n(1)))
      case 'abs': return args[0].t === 'f' ? float(Math.abs(n(0))) : int(Math.abs(n(0)))
      case 'sq': return args[0].t === 'f' ? float(n(0) * n(0)) : int(n(0) * n(0))
      case 'sqrt': return float(Math.sqrt(n(0)))
      case 'pow': return float(n(0) ** n(1))
      case 'sin': return float(Math.sin(n(0)))
      case 'cos': return float(Math.cos(n(0)))
      case 'tan': return float(Math.tan(n(0)))
      case 'floor': return float(Math.floor(n(0)))
      case 'ceil': return float(Math.ceil(n(0)))
      case 'round': return float(Math.round(n(0)))
      case 'random': {
        const low = args.length === 2 ? Math.trunc(n(0)) : 0
        const high = Math.trunc(args.length === 2 ? n(1) : n(0))
        return int(high <= low ? low : low + Math.floor(this.random() * (high - low)))
      }
      case 'randomSeed': this.seed = (Math.trunc(n(0)) >>> 0) || 1; return int(0)
      case 'bitRead': return int((Math.trunc(n(0)) >> Math.trunc(n(1))) & 1)
      case 'bit':
      case '_BV': return int(2 ** Math.trunc(n(0)))
      case 'highByte': return int((Math.trunc(n(0)) >> 8) & 0xff)
      case 'lowByte': return int(Math.trunc(n(0)) & 0xff)
      case 'F': return args[0]
    }
    return this.fail(`'${e.name}' was not declared in this scope`)
  }

  private callObject(e: Extract<Expr, { k: 'call' }>): Value {
    const slot = this.findSlot(e.obj!)
    let handle: Value | undefined = slot?.value
    if (e.index) {
      const index = Math.trunc(this.toNumber(this.eval(e.index)))
      if (!slot?.arr || index < 0 || index >= slot.arr.length) this.fail(`index ${index} is outside object array '${e.obj}'`)
      handle = slot.arr[index]
    }
    const object = handle && handle.t !== 's' ? this.objects[handle.v] : undefined
    if (!object) return this.fail(`'${e.obj}' is not an object`)
    const args = e.args.map((arg) => this.eval(arg))
    this.line = e.line
    if (object.cls !== 'Servo') {
      this.warn(`${object.name}.${e.name}() was skipped: the ${object.cls} library isn't simulated.`)
      return int(0)
    }
    return this.callServo(object, e.name, args)
  }

  private callServo(servo: LibraryObject, method: string, args: Value[]): Value {
    const call = `${servo.name}.${method}(${args.map((arg) => this.toText(arg)).join(', ')})`
    const n = (i: number) => Math.trunc(this.toNumber(args[i]))
    switch (method) {
      case 'attach': {
        const pin = this.resolvePin(args[0], `${servo.name}.attach`)
        if (!pin) return int(0)
        const before = this.snapshot()
        servo.pin = pin
        servo.attached = true
        if (args.length >= 3) { servo.min = n(1); servo.max = n(2) }
        this.regs[`DDR${pin.port}`] |= 1 << pin.bit
        for (const id of ['D9', 'D10']) {
          if (this.pwm[id] !== undefined) { delete this.pwm[id]; this.warn('Attaching a servo takes over Timer1, so analogWrite() on D9 and D10 stops working.') }
        }
        this.emit('servo', call, pin, [
          this.codeStep(call),
          ...this.pinSteps(pin),
          { kind: 'REGISTER', title: `DDR${pin.port} · bit ${pin.bit} → 1`, description: `attach() makes ${pin.mcuPin} an output for the control pulses.` },
          { kind: 'TIMER', title: 'Timer1 → servo timing', description: 'The Servo library takes over the 16-bit Timer1 (one tick = 0.5 µs). While it runs, analogWrite() on D9 and D10 stops working.' },
          { kind: 'SIGNAL', title: `${pin.mcuPin} = ${servo.us} µs pulse every 20 ms`, description: 'A 50 Hz pulse train; the pulse width encodes the angle.' },
          this.physicalStep(pin),
        ], `servo on ${pin.id}`, `attach() connects the servo signal wire to ${pin.id}. Timer1 interrupts then raise ${pin.mcuPin} for ${servo.us} µs every 20 ms.`, before)
        return int(1)
      }
      case 'write':
      case 'writeMicroseconds': {
        const value = n(0)
        const us = method === 'write' && value < 544
          ? Math.round(servo.min + ((Math.max(0, Math.min(180, value))) * (servo.max - servo.min)) / 180)
          : Math.max(servo.min, Math.min(servo.max, value))
        const before = this.snapshot()
        servo.us = us
        if (!servo.attached || !servo.pin) {
          this.warn(`${servo.name}.${method}() was called before ${servo.name}.attach(), so no pulses are sent.`)
          return int(0)
        }
        const pin = servo.pin
        const angle = servoAngle(servo)
        this.emit('servo', call, pin, [
          this.codeStep(call),
          { kind: 'TIMER', title: `Timer1 · OCR1A ← ${us * 2}`, description: method === 'write' ? `${Math.max(0, Math.min(180, value))}° maps to a ${us} µs pulse (${servo.min}–${servo.max} µs for 0–180°). At 0.5 µs per tick that's ${us * 2} ticks.` : `A ${us} µs pulse is ${us * 2} Timer1 ticks.` },
          { kind: 'SIGNAL', title: `${pin.mcuPin} = ${us} µs pulse every 20 ms`, description: `${pin.mcuPin} goes HIGH, and the compare match pulls it LOW after ${us} µs.` },
          this.physicalStep(pin),
        ], `servo → ${angle}°`, `write() only changes the pulse width; the servo's own electronics move the horn to ${angle}°. It takes roughly 0.1 s per 60° to get there.`, before)
        return int(0)
      }
      case 'read': return int(servoAngle(servo))
      case 'readMicroseconds': return int(servo.us)
      case 'attached': return int(servo.attached ? 1 : 0)
      case 'detach': {
        if (!servo.attached || !servo.pin) return int(0)
        const before = this.snapshot()
        const pin = servo.pin
        servo.attached = false
        this.emit('servo', call, pin, [
          this.codeStep(call),
          { kind: 'TIMER', title: 'Timer1 pulses → off', description: `No more pulses on ${pin.mcuPin}; the servo stops holding its position.` },
          this.physicalStep(pin),
        ], 'servo released', 'detach() stops the control pulses, so the servo no longer resists being turned.', before)
        return int(0)
      }
    }
    return this.fail(`'class Servo' has no member named '${method}'`)
  }

  private hwPulseIn(args: Value[]): Value {
    const pin = this.resolvePin(args[0], 'pulseIn')
    if (!pin) return int(0)
    const level = this.toNumber(args[1]) ? 'HIGH' : 'LOW'
    const timeout = args[2] ? Math.trunc(this.toNumber(args[2])) : 1_000_000
    if (this.pinState(pin).output) this.warn(`pulseIn(${pinNumberLabel(pin)}, …): ${pin.id} is an OUTPUT. Use pinMode(${pinNumberLabel(pin)}, INPUT) for an echo pin.`)
    const before = this.snapshot()
    // Simulated scene for ultrasonic sensors: with a sweeping servo, an object sits ~18 cm away between 25° and 55°.
    const servo = this.objects.find((object) => object.cls === 'Servo' && object.attached)
    const angle = servo ? servoAngle(servo) : null
    const distance = angle === null ? 30 : angle >= 25 && angle <= 55 ? 18 : 120
    let duration = Math.round(distance * 58.2)
    if (duration > timeout) duration = 0
    this.timeMs += (duration || timeout) / 1000
    const call = `pulseIn(${pinNumberLabel(pin)}, ${level})`
    this.emit('pulse', call, pin, [
      this.codeStep(call),
      ...this.pinSteps(pin),
      { kind: 'REGISTER', title: `PIN${pin.port} · bit ${pin.bit} polled`, description: `pulseIn() keeps reading PIN${pin.port} bit ${pin.bit}: it waits for ${pin.mcuPin} to go ${level}, then counts CPU cycles until it changes back.` },
      { kind: 'SIGNAL', title: duration ? `${pin.mcuPin} ${level} for ${duration} µs` : `No pulse within ${timeout} µs`, description: angle !== null ? `Simulated scene: an object ${distance} cm away while the servo points at ${angle}°.` : `Simulated echo from an object ${distance} cm away.` },
      { kind: 'VALUE', title: `pulseIn() returns ${duration}`, description: duration ? `For an HC-SR04 echo: ${duration} µs / 58 ≈ ${Math.round(duration / 58)} cm (sound travels 0.0343 cm/µs, there and back).` : 'A timeout returns 0.' },
    ], `${duration} µs`, `pulseIn() measures how long ${pin.id} stays ${level}. With an ultrasonic sensor that is the echo's round-trip time, which gives the distance.`, before)
    return int(duration)
  }

  private i2cDevice(address: number): number[] {
    if (!this.i2c.devices[address]) {
      const registers = new Array<number>(256).fill(0)
      if (address === 0x68 || address === 0x69) { registers[0x75] = 0x68; registers[0x6b] = 0x40 }
      this.i2c.devices[address] = registers
    }
    return this.i2c.devices[address]
  }

  private readI2cRegister(address: number, register: number): number {
    const registers = this.i2cDevice(address)
    const reg = register & 0xff
    if ((address === 0x68 || address === 0x69) && reg >= 0x3b && reg <= 0x48) return registers[0x6b] & 0x40 ? 0 : MPU6050_DATA[reg - 0x3b]
    return registers[reg]
  }

  private callWire(e: Extract<Expr, { k: 'call' }>): Value {
    const args = e.args.map((arg) => this.eval(arg))
    this.line = e.line
    const n = (i: number) => Math.trunc(this.toNumber(args[i]))
    const sda = pinMap.find((pin) => pin.id === 'A4')!
    const bytes = (list: number[]) => list.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
    const busStep: TraceStep = { kind: 'PIN', title: 'A4 / A5 → SDA / SCL', description: 'I²C uses PC4 (SDA, data) and PC5 (SCL, clock). Both lines are pulled up and shared by every device on the bus.' }
    switch (e.name) {
      case 'begin': {
        const before = this.snapshot()
        this.i2c.begun = true
        this.regs.TWBR = 72
        this.regs.TWCR = 0x45
        this.regs.PORTC |= 0x30
        this.emit('i2c', 'Wire.begin()', sda, [
          this.codeStep('Wire.begin()'),
          { kind: 'REGISTER', title: 'TWBR ← 72', description: 'Sets the I²C clock to 100 kHz: 16 MHz / (16 + 2 × 72).' },
          { kind: 'REGISTER', title: 'TWCR ← 0x45', description: 'Enables the TWI (two-wire interface) hardware, acknowledgements and its interrupt.' },
          busStep,
          { kind: 'PHYSICAL', title: 'I²C bus ready @ 100 kHz', description: 'A4 and A5 now belong to the I²C bus, so they can no longer be used as analog inputs.' },
        ], 'I²C @ 100 kHz', 'Wire.begin() turns on the ATmega328P TWI peripheral on A4 (SDA) and A5 (SCL).', before)
        return int(0)
      }
      case 'end': this.i2c.begun = false; this.regs.TWCR = 0; return int(0)
      case 'setClock': this.regs.TWBR = Math.max(0, Math.round((16_000_000 / Math.max(1, n(0)) - 16) / 2)); return int(0)
      case 'beginTransmission': this.i2c.address = n(0) & 0x7f; this.i2c.tx = []; return int(0)
      case 'write': {
        const data = args[0].t === 's' ? [...args[0].v].map((char) => char.charCodeAt(0) & 0xff) : [n(0) & 0xff]
        this.i2c.tx.push(...data)
        return int(data.length)
      }
      case 'endTransmission': {
        if (!this.i2c.begun) this.warn('Wire.endTransmission() before Wire.begin(): the I²C hardware is still off.')
        const before = this.snapshot()
        const address = this.i2c.address
        const data = this.i2c.tx
        const registers = this.i2cDevice(address)
        if (data.length) {
          this.i2c.pointer[address] = data[0]
          data.slice(1).forEach((value, i) => { registers[(data[0] + i) & 0xff] = value })
        }
        const device = I2C_DEVICES[address] ?? 'I²C device'
        const isMpu = address === 0x68 || address === 0x69
        const meaning = data.length >= 2 && isMpu && data[0] === 0x6b
          ? `PWR_MGMT_1 ← ${hex2(data[1])}: the MPU6050 ${data[1] & 0x40 ? 'goes to sleep' : 'wakes up'}`
          : data.length >= 2 ? `register ${hex2(data[0])} ← ${bytes(data.slice(1))}` : data.length === 1 ? `register pointer → ${hex2(data[0])}` : 'address probe'
        const call = `Wire → ${hex2(address)} [${bytes(data)}]`
        this.emit('i2c', call, sda, [
          this.codeStep(call),
          busStep,
          { kind: 'REGISTER', title: `TWDR ← ${hex2(address << 1)}`, description: `START, then the 7-bit address ${hex2(address)} + WRITE bit. The ${device} pulls SDA low to acknowledge.` },
          ...(data.length ? [{ kind: 'REGISTER', title: `TWDR ← ${bytes(data)}`, description: 'Each byte goes through TWDR and is clocked out on SCL; the device acknowledges every byte.' }] : []),
          { kind: 'SIGNAL', title: `START · ${hex2(address << 1)}${data.length ? ` · ${bytes(data)}` : ''} · STOP`, description: 'What a logic analyser would show on SDA/SCL.' },
          { kind: 'PHYSICAL', title: `${device}: ${meaning}`, description: 'endTransmission() returns 0: the device acknowledged.' },
        ], `I²C write ${hex2(address)}`, `Wire.beginTransmission(), write() and endTransmission() send bytes to the device at ${hex2(address)} (${device}) over the I²C bus.`, before)
        this.i2c.tx = []
        return int(0)
      }
      case 'requestFrom': {
        const before = this.snapshot()
        const address = n(0) & 0x7f
        const count = Math.max(0, Math.min(32, n(1)))
        const start = this.i2c.pointer[address] ?? 0
        const data = Array.from({ length: count }, (_, i) => this.readI2cRegister(address, start + i))
        this.i2c.pointer[address] = (start + count) & 0xff
        this.i2c.rx = data
        const device = I2C_DEVICES[address] ?? 'I²C device'
        const asleep = (address === 0x68 || address === 0x69) && (this.i2cDevice(address)[0x6b] & 0x40) && start <= 0x48 && start + count > 0x3b
        const call = `Wire ← ${hex2(address)} ×${count}`
        this.emit('i2c', call, sda, [
          this.codeStep(call),
          busStep,
          { kind: 'REGISTER', title: `TWDR ← ${hex2((address << 1) | 1)}`, description: `START with the address ${hex2(address)} + READ bit.` },
          { kind: 'REGISTER', title: `TWDR → ${bytes(data) || '(none)'}`, description: `The ${device} sends ${count} byte${count === 1 ? '' : 's'} starting at register ${hex2(start)}; the MCU acknowledges all but the last.` },
          { kind: 'VALUE', title: `${count} byte${count === 1 ? '' : 's'} ready for Wire.read()`, description: asleep ? 'All zeros: the MPU6050 is still asleep. Write 0 to register 0x6B (PWR_MGMT_1) to wake it.' : 'Read them one at a time with Wire.read().' },
        ], `I²C read ${count} B`, `Wire.requestFrom() reads ${count} bytes from the ${device} at ${hex2(address)}.`, before)
        return int(count)
      }
      case 'read': return int(this.i2c.rx.length ? this.i2c.rx.shift()! : -1)
      case 'available': return int(this.i2c.rx.length)
    }
    return this.fail(`'Wire.${e.name}()' isn't supported by the simulator`)
  }

  private callSerial(e: Extract<Expr, { k: 'call' }>): Value {
    const args = e.args.map((arg) => this.eval(arg))
    this.line = e.line
    const rendered = `Serial.${e.name}(${e.args.map((arg, i) => (arg.k === 'str' ? JSON.stringify(arg.v) : this.toText(args[i]))).join(', ')})`
    switch (e.name) {
      case 'begin': this.hwSerialBegin(args); return int(0)
      case 'end': this.serialBaud = 0; this.regs.UCSR0B = 0; return int(0)
      case 'print':
      case 'println': {
        let text = ''
        if (args.length) {
          const format = args.length > 1 ? Math.trunc(this.toNumber(args[1])) : null
          text = args[0].t === 'f' ? formatFloat(args[0].v, format ?? 2) : this.toText(args[0], format && [2, 8, 10, 16].includes(format) ? format : 10)
        }
        if (e.name === 'println') text += '\n'
        this.hwSerialWrite(text, rendered)
        return int(text.length)
      }
      case 'write': {
        const text = args[0].t === 's' ? args[0].v : String.fromCharCode(Math.trunc(args[0].v) & 0xff)
        this.hwSerialWrite(text, rendered)
        return int(text.length)
      }
      case 'available': return int(0)
      case 'read':
      case 'peek': return int(-1)
      case 'flush': return int(0)
    }
    return this.fail(`'Serial.${e.name}()' isn't supported by the simulator`)
  }

  private callUser(name: string, argExprs: Expr[], line: number): Value {
    const fn = this.program.fns.get(name)!
    if (this.depth >= MAX_CALL_DEPTH) { this.line = line; this.fail(`recursion too deep in '${name}()': the Uno's 2 KB stack would overflow`) }
    const scope = new Map<string, Slot>()
    fn.params.forEach((param, i) => {
      const arg = argExprs[i]
      if (param.isArray) {
        const slot = arg?.k === 'id' ? this.findSlot(arg.name) : null
        if (!slot?.arr) { this.line = line; this.fail(`'${name}()' expects an array for '${param.name}'`) }
        scope.set(param.name, slot)
      } else {
        scope.set(param.name, { type: param.type, isConst: false, value: this.coerce(param.type, this.eval(arg)) })
      }
    })
    const saved = this.scopes
    this.scopes = [scope]
    this.depth++
    try {
      const signal = this.exec(fn.body)
      if (signal?.s === 'return' && signal.v && fn.ret !== 'void') return this.coerce(fn.ret, signal.v)
      return int(0)
    } finally {
      this.depth--
      this.scopes = saved
    }
  }
}

// ---------------------------------------------------------------- public API

// A function definition starts with a type word, e.g. "void setup() {" or "unsigned long readSensor(int pin) {".
const FUNCTION_DEFINITION = new RegExp(String.raw`\b(?:${[...TYPE_WORDS].join('|')})\b[\w\s*]*?\b[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{`)

function looksLikeSnippet(source: string): boolean {
  return !FUNCTION_DEFINITION.test(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
}

export function compileAndRun(source: string): CompileResult {
  const warnings: Diagnostic[] = []
  let program: Program
  let effectiveSource = source
  if (source.trim() && looksLikeSnippet(source)) {
    // Bare statements (no functions): run them once as setup(), keeping line numbers intact.
    effectiveSource = `void setup() { ${source}\n}\nvoid loop() {}`
    warnings.push({ line: 1, message: 'No setup() or loop() found, so your code was run once as setup().' })
  }
  try {
    program = new Parser(tokenize(effectiveSource, warnings)).parseProgram()
  } catch (error) {
    if (error instanceof CompileError) return { ok: false, errors: [{ line: error.line, message: error.message }], warnings }
    throw error
  }
  const errors = checkProgram(program)
  if (errors.length) return { ok: false, errors, warnings }

  const machine = new Machine(program, source)
  let runtimeError: Diagnostic | null = null
  let stopReason = `loop() ran ${MAX_LOOP_ITERATIONS} times. A real board keeps repeating it forever.`
  try {
    machine.run()
  } catch (error) {
    if (error instanceof StopSimulation) stopReason = error.message
    else if (error instanceof RuntimeError) {
      runtimeError = { line: error.line, message: error.message }
      stopReason = 'Stopped by a runtime error.'
    } else throw error
  }
  if (effectiveSource !== source && !runtimeError) stopReason = 'Your snippet ran once.'
  return {
    ok: true,
    events: machine.events,
    serial: machine.serial,
    warnings: [...warnings, ...machine.warnings],
    runtimeError,
    loopIterations: machine.loopIterations,
    stopReason,
    final: machine.snapshot(),
  }
}

export function pinModeIn(snapshot: Snapshot, pin: PinDefinition): { mode: PinMode; level: PinLevel } {
  const mask = 1 << pin.bit
  const output = (snapshot.regs[`DDR${pin.port}`] & mask) !== 0
  const portBit = (snapshot.regs[`PORT${pin.port}`] & mask) !== 0
  return { mode: output ? 'OUTPUT' : portBit ? 'INPUT_PULLUP' : 'INPUT', level: portBit || snapshot.pwm[pin.id] || snapshot.tones[pin.id] || snapshot.servos[pin.id] !== undefined ? 'HIGH' : 'LOW' }
}

export const SIMULATOR_LIMITS = { loopIterations: MAX_LOOP_ITERATIONS, events: MAX_EVENTS }
