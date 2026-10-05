import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowRight, BookOpen, Cable, Camera, ChevronRight, CircleHelp, Code2, Cpu, Gauge, LayoutDashboard, Lightbulb, Menu, Settings2, Usb, X } from 'lucide-react'
import { ArduinoBoard } from './components/ArduinoBoard'
import { CameraScanner } from './components/CameraScanner'
import { CodeVisualizer } from './components/CodeVisualizer'
import { LearnMode } from './components/LearnMode'
import { PeripheralMapper } from './components/PeripheralMapper'
import { PinExplorer } from './components/PinExplorer'
import { RegisterViewer } from './components/RegisterViewer'
import { analogPins, digitalPins, getPin, pinMap, type PeripheralName, type PinLevel, type PinMode } from './data/pins'
import { microBoardSerial, type SerialInfo } from './services/serial'
import { COMPONENT_LESSONS } from './data/componentLessons'
import { lessonKeyFor, mergeProjectComponents, type InventoryPart, type ProjectComponent } from './sim/componentDetection'
import './App.css'

type PageId = 'dashboard' | 'pin-explorer' | 'peripheral-mapper' | 'code-visualizer' | 'camera-scanner' | 'register-viewer' | 'hardware-monitor' | 'learn-mode' | 'settings'

type BoardState = {
  mode: PinMode | null
  level: PinLevel | null
}

const navItems: { id: PageId; label: string; icon: typeof Activity; group: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'WORKSPACE' },
  { id: 'pin-explorer', label: 'Pin Explorer', icon: Cpu, group: 'WORKSPACE' },
  { id: 'peripheral-mapper', label: 'Peripheral Mapper', icon: Cable, group: 'WORKSPACE' },
  { id: 'code-visualizer', label: 'Code Visualizer', icon: Code2, group: 'WORKSPACE' },
  { id: 'camera-scanner', label: 'Camera Scanner', icon: Camera, group: 'WORKSPACE' },
  { id: 'register-viewer', label: 'Register Viewer', icon: Activity, group: 'HARDWARE' },
  { id: 'hardware-monitor', label: 'Hardware Monitor', icon: Gauge, group: 'HARDWARE' },
  { id: 'learn-mode', label: 'Learn Mode', icon: BookOpen, group: 'MORE' },
  { id: 'settings', label: 'Settings', icon: Settings2, group: 'MORE' },
]

const PROJECT_STORAGE_KEY = 'microboard.project.v1'

// Components found in the last compiled sketch and in the scanner inventory survive a page reload.
function loadProject(): { code: ProjectComponent[]; inventory: InventoryPart[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY) ?? '{}') as { code?: ProjectComponent[]; inventory?: InventoryPart[] }
    return {
      code: Array.isArray(saved.code) ? saved.code.filter((part) => part && part.id in COMPONENT_LESSONS) : [],
      inventory: Array.isArray(saved.inventory) ? saved.inventory.filter((part) => part && typeof part.profileId === 'string') : [],
    }
  } catch {
    return { code: [], inventory: [] }
  }
}

const lessons = [
  { title: 'What is an Arduino pin?', body: 'A labelled Arduino pin is a board-level name for a physical connection. Uno D13 is routed to ATmega328P pad PB5.', example: 'D13 → PB5' },
  { title: 'What is an MCU port?', body: 'AVR GPIO pins are grouped into 8-bit ports. Port B contains bits PB0 through PB7, controlled by a set of I/O registers.', example: 'Port B → PB7 … PB0' },
  { title: 'What is a bit?', body: 'A bit is one binary position in a register. D13 is Port B bit 5, so its bit mask is 1 shifted left by 5.', example: 'PB5 → bit 5' },
  { title: 'What is DDRB?', body: 'The Data Direction Register for Port B chooses input or output for each bit. A 1 in DDRB bit 5 configures PB5 as an output.', example: 'DDRB bit 5 = 1 → OUTPUT' },
  { title: 'What is PORTB?', body: 'When PB5 is an output, writing PORTB bit 5 high drives PB5 high. On an input, the PORT bit controls its internal pull-up.', example: 'PORTB bit 5 = 1 → HIGH' },
  { title: 'How does digitalWrite() reach hardware?', body: 'The API resolves the board pin to an AVR port and bit, then updates a register. On Uno R3, D13 is connected to the built-in LED.', example: 'digitalWrite(13, HIGH) → PORTB5' },
]

function initialState<T>(value: T): Record<string, T> {
  return Object.fromEntries(pinMap.map((pin) => [pin.id, value])) as Record<string, T>
}

function parsePinNumber(pinId: string): number | null {
  const match = pinId.match(/^D(\d+)$/)
  if (match) return Number(match[1])
  return null
}

function parseSetResponse(response: string, pinNumber: number, level: PinLevel): boolean {
  return response.trim() === `OK SET ${pinNumber} ${level}`
}

function parseModeResponse(response: string, pinNumber: number, mode: PinMode): boolean {
  return response.trim() === `OK MODE ${pinNumber} ${mode}`
}

function parseReadResponse(response: string, expectedPin: number): BoardState | null {
  const match = response.trim().match(/^READ (\d+) (INPUT|INPUT_PULLUP|OUTPUT) (HIGH|LOW)$/)
  if (!match) return null
  if (Number(match[1]) !== expectedPin) return null

  return { mode: match[2] as PinMode, level: match[3] as PinLevel }
}

function parseStatusResponse(response: string): Record<string, BoardState> | null {
  const tokens = response.trim().split(/\s+/)
  if (tokens.length !== 43 || tokens[0] !== 'STATUS') return null

  const states: Record<string, BoardState> = {}

  for (let pinNumber = 0; pinNumber < 14; pinNumber++) {
    const offset = 1 + pinNumber * 3
    const expectedPin = `D${pinNumber}`
    const pinToken = tokens[offset]
    const modeToken = tokens[offset + 1]
    const levelToken = tokens[offset + 2]
    if (pinToken !== expectedPin) return null
    if (modeToken !== 'INPUT' && modeToken !== 'INPUT_PULLUP' && modeToken !== 'OUTPUT') return null
    if (levelToken !== 'HIGH' && levelToken !== 'LOW') return null
    states[expectedPin] = { mode: modeToken, level: levelToken }
  }

  return states
}

function App() {
  const [page, setPage] = useState<PageId>('dashboard')
  const [selectedPin, setSelectedPin] = useState('D13')
  const [activePeripheral, setActivePeripheral] = useState<PeripheralName | null>(null)
  const [modes, setModes] = useState<Record<string, PinMode>>(() => ({ ...initialState<PinMode>('INPUT'), D13: 'OUTPUT' }))
  const [levels, setLevels] = useState<Record<string, PinLevel>>(() => initialState<PinLevel>('LOW'))
  const [physicalPins, setPhysicalPins] = useState<Record<string, BoardState>>({})
  const [serialInfo, setSerialInfo] = useState<SerialInfo>(microBoardSerial.getSnapshot())
  const [toast, setToast] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [activeLesson, setActiveLesson] = useState('basic-0')
  const [codeParts, setCodeParts] = useState<ProjectComponent[]>(() => loadProject().code)
  const [inventoryParts, setInventoryParts] = useState<InventoryPart[]>(() => loadProject().inventory)
  const [generatedDesignCode, setGeneratedDesignCode] = useState<string | null>(null)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const pin = getPin(selectedPin)
  const ledOn = modes.D13 === 'OUTPUT' && levels.D13 === 'HIGH'
  const isPhysicalConnected = serialInfo.state === 'connected'
  const projectParts = useMemo(() => mergeProjectComponents(codeParts, inventoryParts), [codeParts, inventoryParts])

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify({ code: codeParts, inventory: inventoryParts }))
    } catch {
      // Storage can be unavailable (private mode); the project then lasts for this session only.
    }
  }, [codeParts, inventoryParts])

  useEffect(() => {
    const unsubscribe = microBoardSerial.subscribe((next) => {
      setSerialInfo(next)
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3400)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (serialInfo.error) setToast(serialInfo.error)
  }, [serialInfo.error])

  useEffect(() => {
    if (isPhysicalConnected) {
      void refreshPhysicalStatus()
    }
  }, [isPhysicalConnected])

  function navigate(nextPage: PageId) {
    setPage(nextPage)
    setMobileNavOpen(false)
    if (nextPage !== 'peripheral-mapper') setActivePeripheral(null)
  }

  function selectAndExplore(pinId: string) {
    setSelectedPin(pinId)
    navigate('pin-explorer')
  }

  async function refreshPhysicalStatus() {
    if (!isPhysicalConnected) return
    try {
      const response = await microBoardSerial.sendCommand('STATUS')
      const nextStates = parseStatusResponse(response)
      if (!nextStates) throw new Error(`Malformed STATUS response: ${response}`)
      setPhysicalPins(nextStates)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read Arduino status.'
      setToast(message)
    }
  }

  async function handleConnectArduino() {
    if (serialInfo.state === 'connecting') return

    if (isPhysicalConnected) {
      try {
        await microBoardSerial.disconnect()
        setPhysicalPins({})
        setToast('Physical Arduino disconnected.')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to disconnect Arduino.'
        setToast(message)
      }
      return
    }

    try {
      setPhysicalPins({})
      await microBoardSerial.connect()
      setToast('Arduino connected via Web Serial.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to connect to Arduino.'
      setToast(message)
    }
  }

  async function handlePinModeChange(nextMode: PinMode) {
    setModes((current) => ({ ...current, [selectedPin]: nextMode }))

    if (!isPhysicalConnected || !selectedPin.startsWith('D')) {
      return
    }

    const pinNumber = parsePinNumber(selectedPin)
    if (pinNumber === null) return

    try {
      const response = await microBoardSerial.sendCommand(`MODE ${pinNumber} ${nextMode}`)
      if (!parseModeResponse(response, pinNumber, nextMode)) {
        throw new Error(`Arduino rejected MODE command: ${response}`)
      }
      setPhysicalPins((current) => ({
        ...current,
        [selectedPin]: {
          mode: nextMode,
          level: null,
        },
      }))
      setToast(`Physical response: ${response}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update hardware mode.'
      setToast(message)
    }
  }

  async function handlePinLevelChange(nextLevel: PinLevel) {
    setLevels((current) => ({ ...current, [selectedPin]: nextLevel }))

    if (!isPhysicalConnected || !selectedPin.startsWith('D')) {
      return
    }

    const pinNumber = parsePinNumber(selectedPin)
    if (pinNumber === null) return

    try {
      const response = await microBoardSerial.sendCommand(`SET ${pinNumber} ${nextLevel}`)
      if (!parseSetResponse(response, pinNumber, nextLevel)) {
        throw new Error(`Arduino rejected SET command: ${response}`)
      }
      setPhysicalPins((current) => ({
        ...current,
        [selectedPin]: {
          mode: current[selectedPin]?.mode ?? 'OUTPUT',
          level: nextLevel,
        },
      }))
      setToast(`Physical response: ${response}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update hardware state.'
      setToast(message)
    }
  }

  async function handleReadPhysical(pinId: string) {
    if (!isPhysicalConnected || !pinId.startsWith('D')) {
      setToast('Physical read is available only when the Arduino is connected.')
      return
    }

    const pinNumber = parsePinNumber(pinId)
    if (pinNumber === null) return

    try {
      const response = await microBoardSerial.sendCommand(`READ ${pinNumber}`)
      const parsed = parseReadResponse(response, pinNumber)
      if (!parsed) throw new Error(`Malformed READ response: ${response}`)
      setPhysicalPins((current) => ({ ...current, [pinId]: parsed }))
      setToast(`Physical read: ${response}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read the physical pin state.'
      setToast(message)
    }
  }

  function updateSimulation(pinId: string, mode: PinMode, level: PinLevel) {
    setModes((current) => ({ ...current, [pinId]: mode }))
    setLevels((current) => ({ ...current, [pinId]: level }))
  }

  function renderPage() {
    switch (page) {
      case 'pin-explorer':
        return <PinExplorer
          selectedPin={selectedPin}
          onSelectPin={setSelectedPin}
          mode={modes[selectedPin]}
          level={levels[selectedPin]}
          physicalState={physicalPins[selectedPin] ?? { mode: null, level: null }}
          isPhysicalConnected={isPhysicalConnected}
          onModeChange={handlePinModeChange}
          onLevelChange={handlePinLevelChange}
          onReadPhysical={() => handleReadPhysical(selectedPin)}
          ledOn={ledOn}
          activePeripheral={activePeripheral}
        />
      case 'peripheral-mapper':
        return <PeripheralMapper activePeripheral={activePeripheral} selectedPin={selectedPin} onPeripheralChange={setActivePeripheral} onSelectPin={setSelectedPin} />
      case 'code-visualizer':
        return <CodeVisualizer key={generatedDesignCode ?? 'starter'} initialCode={generatedDesignCode ?? undefined} onSimulationChange={updateSimulation} onSelectPin={setSelectedPin} reducedMotion={reducedMotion} onComponentsDetected={(parts) => { setCodeParts(parts); if (parts[0]) setActiveLesson(lessonKeyFor(parts[0])) }} onOpenLearnMode={() => navigate('learn-mode')} />
      case 'camera-scanner':
        return <CameraScanner onOpenCodeVisualizer={(code) => { setGeneratedDesignCode(code); navigate('code-visualizer') }} onInventoryChange={setInventoryParts} />
      case 'register-viewer':
        return <RegisterViewer selectedPin={pin} modes={modes} levels={levels} onSelectPin={setSelectedPin} onTogglePin={(pinId) => { if (modes[pinId] === 'OUTPUT') setLevels((current) => ({ ...current, [pinId]: current[pinId] === 'HIGH' ? 'LOW' : 'HIGH' })); else setToast('Set this pin to OUTPUT in Pin Explorer before toggling its output level.') }} />
      case 'hardware-monitor':
        return <HardwareMonitor
          modes={modes}
          levels={levels}
          onSelectPin={selectAndExplore}
          serialInfo={serialInfo}
          physicalPins={physicalPins}
          selectedPin={selectedPin}
          onRefreshStatus={() => void refreshPhysicalStatus()}
          onReadPin={handleReadPhysical}
        />
      case 'learn-mode':
        return <LearnMode basics={lessons} parts={projectParts} activeLesson={activeLesson} onSelectLesson={setActiveLesson} onOpenCodeVisualizer={() => navigate('code-visualizer')} onOpenScanner={() => navigate('camera-scanner')} onClearProject={() => { setCodeParts([]); setInventoryParts([]) }} />
      case 'settings':
        return <SettingsPage reducedMotion={reducedMotion} onChangeMotion={setReducedMotion} onReset={() => { setModes(initialState('INPUT')); setLevels(initialState('LOW')); setPhysicalPins({}); setToast('Virtual pin state reset.') }} />
      default:
        return <Dashboard selectedPin={selectedPin} mode={modes[selectedPin]} level={levels[selectedPin]} ledOn={ledOn} serialInfo={serialInfo} serialAvailable={serialInfo.isAvailable} onNavigate={navigate} onSelectPin={selectAndExplore} onConnect={handleConnectArduino} />
    }
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} onNavigate={navigate} mobileOpen={mobileNavOpen} serialInfo={serialInfo} />
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu icon-button" type="button" onClick={() => setMobileNavOpen((open) => !open)} aria-label="Toggle navigation"><Menu size={19} /></button><div className="breadcrumbs"><span>MICROBOARD</span><ChevronRight size={13} /><strong>{navItems.find((item) => item.id === page)?.label.toUpperCase()}</strong></div></div>
          <div className="topbar-right"><span className="connection-status"><i /> PHYSICAL: {serialInfo.state === 'connected' ? 'CONNECTED' : serialInfo.state === 'connecting' ? 'CONNECTING...' : serialInfo.state === 'error' ? 'ERROR' : 'DISCONNECTED'}</span><span className="topbar-divider" /><span className="target-chip"><Cpu size={14} /> SIMULATION: ACTIVE</span><button className="connect-button" type="button" onClick={handleConnectArduino} disabled={!serialInfo.isAvailable || serialInfo.state === 'connecting'} title={!serialInfo.isAvailable ? 'Web Serial is unavailable in this browser.' : undefined}><Usb size={15} /><span>{isPhysicalConnected ? 'Disconnect Arduino' : serialInfo.state === 'connecting' ? 'Selecting device...' : serialInfo.isAvailable ? 'Connect Arduino' : 'Web Serial unavailable'}</span></button></div>
        </header>
        <div className="content-area" key={page}>{renderPage()}</div>
        <footer className="app-footer"><span><i /> SIMULATION ENVIRONMENT</span><span>UNO R3 <b>·</b> ATMEGA328P <b>·</b> 16 MHz</span></footer>
      </main>
      {toast && <div className="toast-message" role="status"><CircleHelp size={16} /><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
    </div>
  )
}

function Sidebar({ page, onNavigate, mobileOpen, serialInfo }: { page: PageId; onNavigate: (page: PageId) => void; mobileOpen: boolean; serialInfo: SerialInfo }) {
  return <>
    {mobileOpen && <button type="button" className="sidebar-scrim" onClick={() => onNavigate(page)} aria-label="Close navigation" />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand-lockup"><div className="brand-mark"><Activity size={21} /></div><div><strong>MicroBoard<span>.</span></strong><small>STUDIO / 01</small></div></div>
      <div className="board-context"><span className="board-icon"><Cpu size={17} /></span><div><strong>Arduino Uno R3</strong><small>ATmega328P target</small></div><span className="board-ready-dot" /></div>
      <nav className="main-nav" aria-label="Main navigation">{['WORKSPACE', 'HARDWARE', 'MORE'].map((group) => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{navItems.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => <button type="button" key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => onNavigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{page === id && <i />}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-status"><span className="status-lamp" /><div><strong>SIMULATION ACTIVE</strong><small>{serialInfo.state === 'connected' ? 'Physical Arduino connected' : 'Hardware disconnected'}</small></div></div><span className="sidebar-version">MICROBOARD STUDIO · V0.1</span></div>
    </aside>
  </>
}

function Dashboard({ selectedPin, mode, level, ledOn, serialInfo, serialAvailable, onNavigate, onSelectPin, onConnect }: { selectedPin: string; mode: PinMode; level: PinLevel; ledOn: boolean; serialInfo: SerialInfo; serialAvailable: boolean; onNavigate: (page: PageId) => void; onSelectPin: (pinId: string) => void; onConnect: () => void }) {
  const pin = getPin(selectedPin)
  return <div className="page-stack dashboard-page">
    <div className="dashboard-intro"><div><span className="eyebrow">ENGINEERING WORKSPACE / 01</span><h1>See what happens <em>inside.</em></h1><p>Trace an Arduino call through the ATmega328P, register by register.</p></div><button type="button" className="connect-status-card" onClick={onConnect} disabled={!serialAvailable || serialInfo.state === 'connecting'} title={!serialAvailable ? 'Web Serial is unavailable in this browser.' : undefined}><span className="connection-led" /><span><strong>PHYSICAL ARDUINO CONNECTION</strong><small>{!serialAvailable ? 'WEB SERIAL UNAVAILABLE' : serialInfo.state === 'connected' ? 'CONNECTED · live USB session' : 'DISCONNECTED · simulation mode active'}</small></span><Usb size={17} /></button></div>
    <section className="stats-grid">{[{ title: 'Digital pins', value: '14', note: 'D0 — D13', icon: Activity }, { title: 'Analog inputs', value: '06', note: '10-bit ADC', icon: Gauge }, { title: 'PWM outputs', value: '06', note: 'Timer controlled', icon: Activity }, { title: 'ADC channels', value: '06', note: 'A0 — A5', icon: Cpu }].map(({ title, value, note, icon: Icon }, index) => <div className={`stat-card stat-${index}`} key={title}><span className="stat-icon"><Icon size={16} /></span><span className="stat-label">{title}</span><strong>{value}</strong><small>{note}</small><span className="stat-corner" /></div>)}</section>
    <div className="dashboard-content-grid"><ArduinoBoard selectedPin={selectedPin} onSelectPin={onSelectPin} ledOn={ledOn} /><div className="dashboard-side"><section className="panel current-pin-panel"><div className="panel-heading"><div><span className="eyebrow">CURRENTLY SELECTED</span><h2>Pin snapshot</h2></div><button className="text-link" type="button" onClick={() => onNavigate('pin-explorer')}>EXPLORE <ArrowRight size={13} /></button></div><div className="snapshot-map"><div><small>ARDUINO</small><strong>{pin.id}</strong></div><ArrowRight size={19} /><div><small>ATMEGA328P</small><strong>{pin.mcuPin}</strong></div></div><div className="snapshot-register">PORT {pin.port} <i /> BIT {pin.bit}</div><div className="snapshot-functions">{pin.functions.map((fn) => <span key={fn}>{fn}</span>)}</div><div className="snapshot-state"><span>{mode} <i /> {level}</span>{pin.id === 'D13' && <strong className={ledOn ? 'led-on' : ''}><Lightbulb size={13} /> LED {ledOn ? 'ON' : 'OFF'}</strong>}</div></section>
      <section className="panel quick-panel"><div className="panel-heading"><div><span className="eyebrow">SHORTCUTS</span><h2>Quick actions</h2></div></div><div className="quick-actions">{[{ text: 'Pin Explorer', page: 'pin-explorer' as PageId, icon: Cpu }, { text: 'Code Visualizer', page: 'code-visualizer' as PageId, icon: Code2 }, { text: 'Camera Scanner', page: 'camera-scanner' as PageId, icon: Camera }, { text: 'Register Viewer', page: 'register-viewer' as PageId, icon: Activity }, { text: 'Peripheral Mapper', page: 'peripheral-mapper' as PageId, icon: Cable }].map(({ text, page: targetPage, icon: Icon }) => <button type="button" key={text} onClick={() => onNavigate(targetPage)}><Icon size={15} /><span>{text}</span><ArrowRight size={14} /></button>)}</div></section></div></div>
    <section className="panel scanner-dashboard-card">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">AI COMPONENT SCANNER</span>
          <h2>Identify boards from the laptop camera</h2>
        </div>
      </div>
      <div className="scanner-dashboard-body">
        <div className="scanner-dashboard-statuses">
          <span className="status-chip">CAMERA: READY</span>
          <span className="status-chip accent">AI MODEL: YOLO11n ONNX</span>
        </div>
        <button type="button" className="secondary-button scanner-open-button" onClick={() => onNavigate('camera-scanner')}>
          OPEN CAMERA SCANNER
        </button>
      </div>
      <p className="scanner-dashboard-note">Detected boards are separate from physical USB connection status.</p>
    </section>
    <div className="dashboard-banners"><button type="button" className="code-banner" onClick={() => onNavigate('code-visualizer')}><span className="banner-symbol"><Code2 size={19} /></span><span><small>SOFTWARE → SILICON</small><strong>Follow digitalWrite() to its physical output.</strong></span><ArrowRight size={16} /></button><button type="button" className="learn-banner" onClick={() => onNavigate('learn-mode')}><BookOpen size={19} /><span><small>LEARN MODE</small><strong>Explore six AVR fundamentals</strong></span><ArrowRight size={15} /></button></div>
  </div>
}

function HardwareMonitor({ modes, levels, onSelectPin, serialInfo, physicalPins, selectedPin, onRefreshStatus, onReadPin }: { modes: Record<string, PinMode>; levels: Record<string, PinLevel>; onSelectPin: (pinId: string) => void; serialInfo: SerialInfo; physicalPins: Record<string, BoardState>; selectedPin: string; onRefreshStatus: () => void; onReadPin: (pinId: string) => void }) {
  const physicalState = physicalPins[selectedPin] ?? { mode: null, level: null }

  return <div className="page-stack"><div className="page-title-row"><div><span className="eyebrow">PHYSICAL / SERIAL STATE</span><h1>Hardware monitor</h1><p>Read and display the real Arduino Uno connection, status, and last command response.</p></div><span className="simulation-tag large"><i /> {serialInfo.state === 'connected' ? 'PHYSICAL: CONNECTED' : 'PHYSICAL: DISCONNECTED'}</span></div>
    <section className="panel hardware-summary-panel">
      <div className="panel-heading"><div><span className="eyebrow">CONNECTION</span><h2>USB serial overview</h2></div><button type="button" className="secondary-button" onClick={onRefreshStatus}>Refresh status</button></div>
      <div className="hardware-summary-grid">
        <div className="hardware-summary-item"><span>Connection</span><strong>{serialInfo.state === 'connected' ? 'CONNECTED' : serialInfo.state === 'connecting' ? 'CONNECTING...' : serialInfo.state === 'error' ? 'ERROR' : 'DISCONNECTED'}</strong></div>
        <div className="hardware-summary-item"><span>Baud</span><strong>{serialInfo.baudRate}</strong></div>
        <div className="hardware-summary-item"><span>Selected pin</span><strong>{selectedPin}</strong></div>
        <div className="hardware-summary-item"><span>Mode</span><strong>{serialInfo.state === 'connected' ? physicalState.mode ?? 'UNKNOWN' : 'UNKNOWN'}</strong></div>
        <div className="hardware-summary-item"><span>State</span><strong>{serialInfo.state === 'connected' ? physicalState.level ?? 'UNKNOWN' : 'UNKNOWN'}</strong></div>
        <div className="hardware-summary-item"><span>Port</span><strong>{serialInfo.portName}</strong></div>
      </div>
      {serialInfo.error && <p className="serial-error-message" role="status">{serialInfo.error}</p>}
      <div className="command-response-grid">
        <div className="response-box"><span>Last command</span><strong>{serialInfo.lastCommand || 'None'}</strong></div>
        <div className="response-box"><span>Last response</span><strong>{serialInfo.lastResponse || 'No response yet'}</strong></div>
      </div>
      <div className="hardware-actions"><button type="button" className="secondary-button" onClick={() => onReadPin(selectedPin)} disabled={!selectedPin.startsWith('D')}>READ {selectedPin}</button><button type="button" className="primary-button" onClick={onRefreshStatus}>STATUS</button></div>
    </section>
    {[{ label: 'DIGITAL I/O', pins: digitalPins }, { label: 'ANALOG INPUTS', pins: analogPins }].map(({ label, pins }) => <section className="panel monitor-panel" key={label}><div className="panel-heading"><div><span className="eyebrow">{label}</span><h2>{pins.length} pins</h2></div><span className="monitor-note">{serialInfo.state === 'connected' ? 'REAL BOARD STATE' : 'SIMULATION VALUE'}</span></div><div className="monitor-grid">{pins.map((item) => {
      const state = serialInfo.state === 'connected' ? (physicalPins[item.id] ?? { mode: null, level: null }) : { mode: modes[item.id], level: levels[item.id] }
      return <button className="monitor-card" type="button" key={item.id} onClick={() => onSelectPin(item.id)}><div><strong>{item.id}</strong><i className={state.level === 'HIGH' ? 'active' : ''} /></div><span className="monitor-mcu">{item.mcuPin} <small>BIT {item.bit}</small></span><span className="monitor-mode">{state.mode ?? 'UNKNOWN'}</span><small className="monitor-function">{item.functions.join(' · ')}</small><span className={`monitor-level ${state.level === 'HIGH' ? 'high' : ''}`}>{state.level ?? 'UNKNOWN'}</span></button>
    })}</div></section>)}</div>
}


function SettingsPage({ reducedMotion, onChangeMotion, onReset }: { reducedMotion: boolean; onChangeMotion: (value: boolean) => void; onReset: () => void }) {
  return <div className="page-stack"><div className="page-title-row"><div><span className="eyebrow">PREFERENCES / LOCAL WORKSPACE</span><h1>Settings</h1><p>Adjust simulation and accessibility preferences.</p></div><Settings2 className="page-icon" size={22} /></div><section className="panel settings-panel"><div className="panel-heading"><div><span className="eyebrow">PREFERENCES</span><h2>Workspace behavior</h2></div></div><label className="setting-row"><span><strong>Reduce animation</strong><small>Show code flow stages immediately and limit motion.</small></span><input type="checkbox" checked={reducedMotion} onChange={(event) => onChangeMotion(event.target.checked)} /></label><div className="setting-row"><span><strong>Hardware communication</strong><small>Web Serial is available only when the browser supports it and a physical Arduino is connected.</small></span><span className="connection-status"><i /> {microBoardSerial.isConnected() ? 'CONNECTED' : 'DISCONNECTED'}</span></div><div className="setting-row"><span><strong>Reset simulation</strong><small>Return all virtual pins to INPUT and LOW.</small></span><button type="button" className="secondary-button" onClick={onReset}>Reset pins</button></div></section></div>
}

export default App