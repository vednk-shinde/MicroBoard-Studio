export type SerialConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SerialInfo {
  state: SerialConnectionState
  connected: boolean
  isAvailable: boolean
  portName: string
  baudRate: number
  lastCommand: string
  lastResponse: string
  error: string
}

const DEFAULT_BAUD_RATE = 115200
const RESPONSE_TIMEOUT_MS = 5000

type ResponseWaiter = {
  /** Background polling: its command and response aren't shown in the Last command / Last response boxes. */
  silent: boolean
  resolve: (value: string) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type SerialPortInfo = {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialPort {
  readable?: ReadableStream<Uint8Array>
  writable?: WritableStream<Uint8Array>
  getInfo?: () => SerialPortInfo
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
}

interface SerialDevice {
  requestPort: () => Promise<SerialPort>
}

type NavigatorWithSerial = Navigator & {
  serial?: SerialDevice
}

function readPortLabel(port?: SerialPort): string {
  if (!port) return 'Serial Port'
  const info = port.getInfo ? port.getInfo() : undefined
  if (info && typeof info.usbProductId === 'number' && typeof info.usbVendorId === 'number') {
    return `USB Serial (${info.usbVendorId.toString(16).toUpperCase()}:${info.usbProductId.toString(16).toUpperCase()})`
  }
  return 'Serial Port'
}

class MicroBoardSerialService {
  private listeners = new Set<(info: SerialInfo) => void>()
  private port: SerialPort | null = null
  private encoder = new TextEncoder()
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private readLoopTask: Promise<void> | null = null
  private disconnecting = false
  private commandQueue: Promise<void> = Promise.resolve()
  private responseWaiters: ResponseWaiter[] = []
  private currentInfo: SerialInfo = {
    state: 'disconnected',
    connected: false,
    isAvailable: typeof navigator !== 'undefined' && 'serial' in navigator,
    portName: 'Serial Port',
    baudRate: DEFAULT_BAUD_RATE,
    lastCommand: '',
    lastResponse: '',
    error: '',
  }

  public subscribe(listener: (info: SerialInfo) => void): () => void {
    this.listeners.add(listener)
    listener({ ...this.currentInfo })
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getSnapshot(): SerialInfo {
    return { ...this.currentInfo }
  }

  public isConnected(): boolean {
    return this.currentInfo.state === 'connected' && this.port?.readable != null && this.port.writable != null
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator
  }

  private emit(): void {
    const snapshot = { ...this.currentInfo }
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private queueResponse(line: string): void {
    const trimmed = line.trim()
    if (!trimmed || trimmed === 'READY') return

    if (!this.responseWaiters[0]?.silent) {
      this.currentInfo.lastResponse = trimmed
      this.emit()
    }

    if (this.responseWaiters.length > 0) {
      const { resolve, timer } = this.responseWaiters.shift()!
      clearTimeout(timer)
      resolve(trimmed)
    }
  }

  private rejectPendingResponses(message: string): void {
    const waiters = this.responseWaiters.splice(0)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(message))
    }
  }

  private markDisconnected(message: string): void {
    this.port = null
    this.currentInfo.state = 'disconnected'
    this.currentInfo.connected = false
    this.currentInfo.portName = 'Serial Port'
    this.currentInfo.error = message
    this.rejectPendingResponses(message)
    this.emit()
  }

  private async openPort(): Promise<void> {
    if (!this.isSupported()) {
      throw new Error('Web Serial is not available in this browser. Use a supported Chromium-based browser.')
    }

    const serialApi = (navigator as NavigatorWithSerial).serial
    if (!serialApi) {
      throw new Error('Web Serial is not available in this browser. Use a supported Chromium-based browser.')
    }

    const port = await serialApi.requestPort()
    await port.open({ baudRate: DEFAULT_BAUD_RATE })
    if (!port.readable || !port.writable) {
      await port.close()
      throw new Error('The selected serial port does not provide readable and writable streams.')
    }

    this.port = port
    this.currentInfo.portName = readPortLabel(port)
    this.currentInfo.state = 'connected'
    this.currentInfo.connected = true
    this.currentInfo.error = ''
    this.emit()

    this.readLoopTask = this.readLoop()
  }

  private async readLoop(): Promise<void> {
    const port = this.port
    if (!port?.readable) {
      return
    }

    const textDecoder = new TextDecoder()
    let buffer = ''
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

    try {
      reader = port.readable.getReader()
      this.reader = reader
      while (this.port === port && port.readable) {
        const { value, done } = await reader.read()
        if (done) {
          if (!this.disconnecting) this.markDisconnected('The serial connection was closed.')
          break
        }

        buffer += textDecoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          this.queueResponse(line)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Serial communication error.'
      if (!this.disconnecting) this.markDisconnected(message)
    } finally {
      this.reader = null
      if (reader) {
        try {
          reader.releaseLock()
        } catch {
          // The reader can already be released after a stream failure.
        }
      }
    }
  }

  public async connect(): Promise<SerialInfo> {
    if (this.isConnected()) {
      return { ...this.currentInfo }
    }

    try {
      this.currentInfo.state = 'connecting'
      this.currentInfo.connected = false
      this.currentInfo.error = ''
      this.emit()

      await this.openPort()
      return { ...this.currentInfo }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to connect to Arduino.'
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      this.currentInfo.state = cancelled ? 'disconnected' : 'error'
      this.currentInfo.connected = false
      this.currentInfo.error = cancelled ? 'Device selection was cancelled.' : message
      this.currentInfo.portName = 'Serial Port'
      this.emit()
      throw error
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.port) {
      this.currentInfo.state = 'disconnected'
      this.currentInfo.connected = false
      this.currentInfo.error = ''
      this.currentInfo.portName = 'Serial Port'
      this.emit()
      return
    }

    this.disconnecting = true
    this.rejectPendingResponses('Serial connection closed before a response was received.')
    try {
      await this.reader?.cancel()
      await this.readLoopTask
      await this.port.close()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Serial disconnect failed.'
      this.currentInfo.error = message
    } finally {
      this.port = null
      this.currentInfo.state = 'disconnected'
      this.currentInfo.connected = false
      this.currentInfo.error = ''
      this.currentInfo.portName = 'Serial Port'
      this.emit()
      this.disconnecting = false
      this.reader = null
      this.readLoopTask = null
    }
  }

  public async sendCommand(command: string, options: { silent?: boolean } = {}): Promise<string> {
    const operation = this.commandQueue.then(() => this.sendCommandNow(command, options.silent === true))
    this.commandQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async sendCommandNow(command: string, silent: boolean): Promise<string> {
    if (!this.port || !this.isConnected()) {
      throw new Error('No physical Arduino is currently connected.')
    }

    const writable = this.port.writable
    if (!writable) {
      throw new Error('The serial port is not writable.')
    }

    const normalizedCommand = command.trim()
    const writer = writable.getWriter()
    const payload = this.encoder.encode(`${normalizedCommand}\n`)
    let resolveResponse: (value: string) => void = () => undefined
    let rejectResponse: (reason: Error) => void = () => undefined
    const responsePromise = new Promise<string>((resolve, reject) => {
      resolveResponse = resolve
      rejectResponse = reject
    })
    const waiter: ResponseWaiter = {
      silent,
      resolve: resolveResponse,
      reject: rejectResponse,
      timer: setTimeout(() => {
        const waiterIndex = this.responseWaiters.indexOf(waiter)
        if (waiterIndex >= 0) this.responseWaiters.splice(waiterIndex, 1)
        rejectResponse(new Error(`No response received for: ${normalizedCommand}`))
      }, RESPONSE_TIMEOUT_MS),
    }
    this.responseWaiters.push(waiter)

    try {
      if (!silent) {
        this.currentInfo.lastCommand = normalizedCommand
        this.emit()
      }
      await writer.write(payload)
    } catch (error) {
      const waiterIndex = this.responseWaiters.indexOf(waiter)
      if (waiterIndex >= 0) this.responseWaiters.splice(waiterIndex, 1)
      clearTimeout(waiter.timer)
      rejectResponse(error instanceof Error ? error : new Error('Serial command write failed.'))
    } finally {
      writer.releaseLock()
    }

    return responsePromise
  }
}

export const microBoardSerial = new MicroBoardSerialService()
