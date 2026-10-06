import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, ArrowRight, BookOpen, Cable, Camera, ChevronRight, CircleHelp, Code2, Cpu, Gauge, LayoutDashboard, Lightbulb, Menu, Settings2, Usb, X } from 'lucide-react'
import { ArduinoBoard } from './components/ArduinoBoard'
import { CameraScanner } from './components/CameraScanner'
import { ChatAssistant } from './components/ChatAssistant'
import { CodeVisualizer } from './components/CodeVisualizer'
import { LearnMode } from './components/LearnMode'
import { PeripheralMapper } from './components/PeripheralMapper'
import { PinExplorer } from './components/PinExplorer'
import { RegisterViewer } from './components/RegisterViewer'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { analogPins, digitalPins, getPin, pinMap, type PeripheralName, type PinLevel, type PinMode } from './data/pins'
import { microBoardSerial, type SerialInfo } from './services/serial'
import { scanWiredPins } from './services/pinScan'
import { COMPONENT_LESSONS } from './data/componentLessons'
import { lessonKeyFor, mergeProjectComponents, type InventoryPart, type ProjectComponent } from './sim/componentDetection'
import './App.css'

type PageId = 'dashboard' | 'pin-explorer' | 'peripheral-mapper' | 'code-visualizer' | 'camera-scanner' | 'register-viewer' | 'hardware-monitor' | 'learn-mode' | 'settings'

type BoardState = {
  mode: PinMode | null
  level: PinLevel | null
}

function getNavItems(t: (key: string) => string): { id: PageId; label: string; icon: typeof Activity; group: string }[] {
  return [
    { id: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, group: 'WORKSPACE' },
    { id: 'pin-explorer', label: t('nav.pinExplorer'), icon: Cpu, group: 'WORKSPACE' },
    { id: 'peripheral-mapper', label: t('nav.peripheralMapper'), icon: Cable, group: 'WORKSPACE' },
    { id: 'code-visualizer', label: t('nav.codeVisualizer'), icon: Code2, group: 'WORKSPACE' },
    { id: 'camera-scanner', label: t('nav.cameraScanner'), icon: Camera, group: 'WORKSPACE' },
    { id: 'register-viewer', label: t('nav.registerViewer'), icon: Activity, group: 'HARDWARE' },
    { id: 'hardware-monitor', label: t('nav.hardwareMonitor'), icon: Gauge, group: 'HARDWARE' },
    { id: 'learn-mode', label: t('nav.learnMode'), icon: BookOpen, group: 'MORE' },
    { id: 'settings', label: t('nav.settings'), icon: Settings2, group: 'MORE' },
  ]
}

const PROJECT_STORAGE_KEY = 'microboard.project.v1'

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

type PinScanState = { state: 'idle' | 'scanning' | 'done' | 'unavailable'; wired: string[]; skipped: string[] }

function sameBoardStates(a: Record<string, BoardState>, b: Record<string, BoardState>): boolean {
  const keys = Object.keys(b)
  if (Object.keys(a).length !== keys.length) return false
  return keys.every((key) => a[key]?.mode === b[key].mode && a[key]?.level === b[key].level)
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
  const { t } = useTranslation()
  const navItems = getNavItems(t)
  const [page, setPage] = useState<PageId>('dashboard')
  const [selectedPin, setSelectedPin] = useState('D13')
  const [activePeripheral, setActivePeripheral] = useState<PeripheralName | null>(null)
  const [modes, setModes] = useState<Record<string, PinMode>>(() => ({ ...initialState<PinMode>('INPUT'), D13: 'OUTPUT' }))
  const [levels, setLevels] = useState<Record<string, PinLevel>>(() => initialState<PinLevel>('LOW'))
  const [physicalPins, setPhysicalPins] = useState<Record<string, BoardState>>({})
  // Set when the board answers STATUS with something that isn't MicroBoard's firmware (another sketch is running).
  const [firmwareNote, setFirmwareNote] = useState<string | null>(null)
  const [pinScan, setPinScan] = useState<PinScanState>({ state: 'idle', wired: [], skipped: [] })
  const scanRun = useRef(0)
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
      // Storage can be unavailable
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

  // The Arduino resets when the port opens and needs about 2 s to boot, so a STATUS sent straight away is lost.
  // Wait, read the status (a few quick tries), then scan which pins have something wired to them.
  useEffect(() => {
    if (!isPhysicalConnected) {
      scanRun.current += 1
      setPinScan({ state: 'idle', wired: [], skipped: [] })
      return
    }
    void scanBoard(2000)
  }, [isPhysicalConnected])

  useEffect(() => {
    if (!isPhysicalConnected) setFirmwareNote(null)
  }, [isPhysicalConnected])

  // Live updates: while the Hardware Monitor is open and the board is connected, ask for STATUS every 700 ms so
  // pins changed by the sketch on the board (or by the buttons here) show up without pressing STATUS.
  useEffect(() => {
    if (!isPhysicalConnected || page !== 'hardware-monitor') return
    let cancelled = false
    let busy = false
    let failures = 0
    const poll = async () => {
      if (busy || document.hidden) return
      busy = true
      try {
        const response = await microBoardSerial.sendCommand('STATUS', { silent: true })
        const next = parseStatusResponse(response)
        if (!next) {
          // Another sketch is answering (or printing its own messages): say so instead of showing UNKNOWN silently.
          if (!cancelled) setFirmwareNote(response)
          return
        }
        failures = 0
        if (!cancelled) {
          setFirmwareNote(null)
          setPhysicalPins((current) => (sameBoardStates(current, next) ? current : next))
        }
      } catch (error) {
        failures += 1
        if (!cancelled && error instanceof Error && error.message.startsWith('No response')) setFirmwareNote('(no reply)')
        else if (failures === 3 && !cancelled) setToast('Live updates are failing. Check the USB cable, then press STATUS.')
      } finally {
        busy = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 700)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isPhysicalConnected, page])

  function navigate(nextPage: PageId) {
    setPage(nextPage)
    setMobileNavOpen(false)
    if (nextPage !== 'peripheral-mapper') setActivePeripheral(null)
  }

  function selectAndExplore(pinId: string) {
    setSelectedPin(pinId)
    navigate('pin-explorer')
  }

  async function scanBoard(delayMs: number) {
    const run = ++scanRun.current
    const stale = () => run !== scanRun.current
    const send = (command: string) => microBoardSerial.sendCommand(command, { silent: true, timeoutMs: 2500 })
    setPinScan({ state: 'scanning', wired: [], skipped: [] })
    try {
      if (delayMs) await new Promise((resolve) => window.setTimeout(resolve, delayMs))
      let lastReply = '(no reply)'
      for (let attempt = 0; attempt < 4; attempt++) {
        if (stale()) return
        try {
          const reply = await microBoardSerial.sendCommand('STATUS', { silent: true, timeoutMs: 1500 })
          const statuses = parseStatusResponse(reply)
          if (statuses) {
            setFirmwareNote(null)
            setPhysicalPins(statuses)
            const result = await scanWiredPins(send, statuses)
            const after = parseStatusResponse(await send('STATUS'))
            if (stale()) return
            if (after) setPhysicalPins(after)
            setPinScan({ state: 'done', ...result })
            return
          }
          lastReply = reply
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith('No response')) throw error
        }
      }
      if (!stale()) {
        setFirmwareNote(lastReply)
        setPinScan({ state: 'unavailable', wired: [], skipped: [] })
      }
    } catch (error) {
      if (stale()) return
      setPinScan({ state: 'unavailable', wired: [], skipped: [] })
      setToast(error instanceof Error ? error.message : 'Pin scan failed.')
    }
  }

  async function refreshPhysicalStatus() {
    if (!isPhysicalConnected) return
    try {
      const response = await microBoardSerial.sendCommand('STATUS')
      const nextStates = parseStatusResponse(response)
      if (!nextStates) {
        setFirmwareNote(response)
        setToast('The board did not answer like the MicroBoard firmware. See the notice on this page.')
        return
      }
      setFirmwareNote(null)
      setPhysicalPins(nextStates)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read Arduino status.'
      if (message.startsWith('No response')) setFirmwareNote('(no reply)')
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
          wiredPins={pinScan.wired}
          firmwareNote={firmwareNote}
          selectedPin={selectedPin}
          onRefreshStatus={() => void refreshPhysicalStatus()}
          onReadPin={handleReadPhysical}
        />
      case 'learn-mode':
        return <LearnMode basics={lessons} parts={projectParts} activeLesson={activeLesson} onSelectLesson={setActiveLesson} onOpenCodeVisualizer={() => navigate('code-visualizer')} onOpenScanner={() => navigate('camera-scanner')} onClearProject={() => { setCodeParts([]); setInventoryParts([]) }} />
      case 'settings':
        return <SettingsPage reducedMotion={reducedMotion} onChangeMotion={setReducedMotion} onReset={() => { setModes(initialState('INPUT')); setLevels(initialState('LOW')); setPhysicalPins({}); setToast('Virtual pin state reset.') }} />
      default:
        return <Dashboard selectedPin={selectedPin} mode={modes[selectedPin]} level={levels[selectedPin]} ledOn={ledOn} serialInfo={serialInfo} serialAvailable={serialInfo.isAvailable} pinScan={pinScan} firmwareNote={firmwareNote} onScan={() => void scanBoard(0)} onNavigate={navigate} onSelectPin={selectAndExplore} onConnect={handleConnectArduino} />
    }
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} onNavigate={navigate} mobileOpen={mobileNavOpen} serialInfo={serialInfo} />
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu icon-button" type="button" onClick={() => setMobileNavOpen((open) => !open)} aria-label="Toggle navigation">
              <Menu size={19} />
            </button>
            <div className="breadcrumbs">
              <span>{t('topbar.brand')}</span>
              <ChevronRight size={13} />
              <strong>{navItems.find((item) => item.id === page)?.label.toUpperCase()}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <LanguageSwitcher compact />
            <span className="connection-status">
              <i /> {t('topbar.physical')}: {serialInfo.state === 'connected' ? t('topbar.connected') : serialInfo.state === 'connecting' ? t('topbar.connecting') : serialInfo.state === 'error' ? t('topbar.error') : t('topbar.disconnected')}
            </span>
            <span className="topbar-divider" />
            <span className="target-chip"><Cpu size={14} /> {t('topbar.simulationActive')}</span>
            <button className="connect-button" type="button" onClick={handleConnectArduino} disabled={!serialInfo.isAvailable || serialInfo.state === 'connecting'} title={!serialInfo.isAvailable ? t('topbar.webSerialUnavailable') : undefined}>
              <Usb size={15} />
              <span>{isPhysicalConnected ? t('topbar.disconnectArduino') : serialInfo.state === 'connecting' ? t('topbar.selectingDevice') : serialInfo.isAvailable ? t('topbar.connectArduino') : t('topbar.webSerialUnavailable')}</span>
            </button>
          </div>
        </header>
        <div className="content-area" key={page}>{renderPage()}</div>
        <footer className="app-footer">
          <span><i /> {t('footer.simulationEnv')}</span>
          <span>{t('footer.boardSpec')}</span>
        </footer>
      </main>
      <ChatAssistant pageLabel={navItems.find((item) => item.id === page)?.label ?? 'Dashboard'} parts={projectParts} />
      {toast && <div className="toast-message" role="status"><CircleHelp size={16} /><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
    </div>
  )
}

function Sidebar({ page, onNavigate, mobileOpen, serialInfo }: { page: PageId; onNavigate: (page: PageId) => void; mobileOpen: boolean; serialInfo: SerialInfo }) {
  const { t } = useTranslation()
  const navItems = getNavItems(t)
  const navGroups = [
    { key: 'WORKSPACE', label: t('nav.workspace') },
    { key: 'HARDWARE', label: t('nav.hardware') },
    { key: 'MORE', label: t('nav.more') }
  ]

  return <>
    {mobileOpen && <button type="button" className="sidebar-scrim" onClick={() => onNavigate(page)} aria-label="Close navigation" />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand-lockup"><div className="brand-mark"><Activity size={21} /></div><div><strong>MicroBoard<span>.</span></strong><small>{t('sidebar.brandStudio')}</small></div></div>
      <div className="board-context"><span className="board-icon"><Cpu size={17} /></span><div><strong>{t('sidebar.boardName')}</strong><small>{t('sidebar.target')}</small></div><span className="board-ready-dot" /></div>
      <nav className="main-nav" aria-label="Main navigation">
        {navGroups.map(({ key, label }) => (
          <div className="nav-group" key={key}>
            <span className="nav-label">{label}</span>
            {navItems.filter((item) => item.group === key).map(({ id, label: itemLabel, icon: Icon }) => (
              <button type="button" key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => onNavigate(id)} aria-current={page === id ? 'page' : undefined}>
                <Icon size={17} strokeWidth={1.8} />
                <span>{itemLabel}</span>
                {page === id && <i />}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-status">
          <span className="status-lamp" />
          <div>
            <strong>{t('sidebar.simulationActive')}</strong>
            <small>{serialInfo.state === 'connected' ? t('sidebar.physicalConnected') : t('sidebar.hardwareDisconnected')}</small>
          </div>
        </div>
        <span className="sidebar-version">{t('sidebar.version')}</span>
      </div>
    </aside>
  </>
}

function Dashboard({ selectedPin, mode, level, ledOn, serialInfo, serialAvailable, pinScan, firmwareNote, onScan, onNavigate, onSelectPin, onConnect }: { selectedPin: string; mode: PinMode; level: PinLevel; ledOn: boolean; serialInfo: SerialInfo; serialAvailable: boolean; pinScan: PinScanState; firmwareNote: string | null; onScan: () => void; onNavigate: (page: PageId) => void; onSelectPin: (pinId: string) => void; onConnect: () => void }) {
  const { t } = useTranslation()
  const pin = getPin(selectedPin)

  const stats = [
    { title: t('dashboard.stats.digitalPins'), value: '14', note: t('dashboard.stats.digitalNote'), icon: Activity },
    { title: t('dashboard.stats.analogInputs'), value: '06', note: t('dashboard.stats.analogNote'), icon: Gauge },
    { title: t('dashboard.stats.pwmOutputs'), value: '06', note: t('dashboard.stats.pwmNote'), icon: Activity },
    { title: t('dashboard.stats.adcChannels'), value: '06', note: t('dashboard.stats.adcNote'), icon: Cpu }
  ]

  const quickActions = [
    { text: t('nav.pinExplorer'), page: 'pin-explorer' as PageId, icon: Cpu },
    { text: t('nav.codeVisualizer'), page: 'code-visualizer' as PageId, icon: Code2 },
    { text: t('nav.cameraScanner'), page: 'camera-scanner' as PageId, icon: Camera },
    { text: t('nav.registerViewer'), page: 'register-viewer' as PageId, icon: Activity },
    { text: t('nav.peripheralMapper'), page: 'peripheral-mapper' as PageId, icon: Cable }
  ]

  return <div className="page-stack dashboard-page">
    <div className="dashboard-intro">
      <div>
        <span className="eyebrow">{t('dashboard.eyebrow')}</span>
        <h1>{t('dashboard.heading')} <em>{t('dashboard.headingHighlight')}</em></h1>
        <p>{t('dashboard.subtitle')}</p>
      </div>
      <button type="button" className="connect-status-card" onClick={onConnect} disabled={!serialAvailable || serialInfo.state === 'connecting'} title={!serialAvailable ? t('dashboard.webSerialUnavailableNote') : undefined}>
        <span className="connection-led" />
        <span>
          <strong>{t('dashboard.physicalConnection')}</strong>
          <small>{!serialAvailable ? t('dashboard.webSerialUnavailableNote') : serialInfo.state === 'connected' ? t('dashboard.connectedNote') : t('dashboard.disconnectedNote')}</small>
        </span>
        <Usb size={17} />
      </button>
    </div>
    <section className="stats-grid">
      {stats.map(({ title, value, note, icon: Icon }, index) => (
        <div className={`stat-card stat-${index}`} key={title}>
          <span className="stat-icon"><Icon size={16} /></span>
          <span className="stat-label">{title}</span>
          <strong>{value}</strong>
          <small>{note}</small>
          <span className="stat-corner" />
        </div>
      ))}
    </section>
    <div className="dashboard-content-grid">
      <ArduinoBoard selectedPin={selectedPin} onSelectPin={onSelectPin} ledOn={ledOn} />
      <div className="dashboard-side">
        <section className="panel current-pin-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">{t('dashboard.currentlySelected')}</span><h2>{t('dashboard.pinSnapshot')}</h2></div>
            <button className="text-link" type="button" onClick={() => onNavigate('pin-explorer')}>{t('dashboard.explore')} <ArrowRight size={13} /></button>
          </div>
          <div className="snapshot-map">
            <div><small>{t('dashboard.arduino')}</small><strong>{pin.id}</strong></div>
            <ArrowRight size={19} />
            <div><small>{t('dashboard.atmega')}</small><strong>{pin.mcuPin}</strong></div>
          </div>
          <div className="snapshot-register">PORT {pin.port} <i /> BIT {pin.bit}</div>
          <div className="snapshot-functions">{pin.functions.map((fn) => <span key={fn}>{fn}</span>)}</div>
          <div className="snapshot-state">
            <span>{mode} <i /> {level}</span>
            {pin.id === 'D13' && <strong className={ledOn ? 'led-on' : ''}><Lightbulb size={13} /> LED {ledOn ? t('dashboard.ledOn') : t('dashboard.ledOff')}</strong>}
          </div>
        </section>
        <section className="panel wired-pins-panel" aria-live="polite">
          <div className="panel-heading">
            <div><span className="eyebrow">CONNECTED BOARD</span><h2>Wired pins</h2></div>
            {serialInfo.state === 'connected' && pinScan.state !== 'scanning' && <button className="text-link" type="button" onClick={onScan}>Scan again</button>}
          </div>
          {serialInfo.state !== 'connected' && <p className="empty-state">Connect your Arduino and MicroBoard will detect which pins have something wired to them.</p>}
          {serialInfo.state === 'connected' && pinScan.state === 'scanning' && <p className="empty-state">Scanning pins D2 to D13…</p>}
          {serialInfo.state === 'connected' && pinScan.state === 'unavailable' && (
            <p className="empty-state wired-warning">
              Connected, but the board is not running the MicroBoard firmware{firmwareNote && firmwareNote !== '(no reply)' ? ` (it said: ${firmwareNote.slice(0, 50)})` : ''}, so pins can't be read. {' '}
              <button className="text-link" type="button" onClick={() => onNavigate('hardware-monitor')}>See how to upload it</button>
            </p>
          )}
          {serialInfo.state === 'connected' && pinScan.state === 'done' && (
            <>
              {pinScan.wired.length > 0
                ? <div className="wired-pin-chips">{pinScan.wired.map((id) => <button type="button" key={id} className="wired-pin-chip" onClick={() => onSelectPin(id)}><i />{id}<small>{getPin(id).mcuPin}</small></button>)}</div>
                : <p className="empty-state">No wired pins found on D2 to D13.</p>}
              <small className="wired-note">
                A pin is shown when something holds it LOW with the internal pull-up on (a wire to GND, an LED with its resistor, a pressed button, a sensor output that is low).
                {pinScan.skipped.length > 0 && ` Not scanned because they are outputs: ${pinScan.skipped.join(', ')}.`}
                {' '}Pins driven HIGH by a sensor look the same as empty pins, and D0/D1 are the USB serial pins.
              </small>
            </>
          )}
        </section>
        <section className="panel quick-panel">
          <div className="panel-heading"><div><span className="eyebrow">{t('dashboard.shortcuts')}</span><h2>{t('dashboard.quickActions')}</h2></div></div>
          <div className="quick-actions">
            {quickActions.map(({ text, page: targetPage, icon: Icon }) => (
              <button type="button" key={text} onClick={() => onNavigate(targetPage)}>
                <Icon size={15} />
                <span>{text}</span>
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
    <section className="panel scanner-dashboard-card">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{t('dashboard.aiScannerEyebrow')}</span>
          <h2>{t('dashboard.aiScannerTitle')}</h2>
        </div>
      </div>
      <div className="scanner-dashboard-body">
        <div className="scanner-dashboard-statuses">
          <span className="status-chip">{t('dashboard.cameraReady')}</span>
          <span className="status-chip accent">{t('dashboard.aiModelReady')}</span>
        </div>
        <button type="button" className="secondary-button scanner-open-button" onClick={() => onNavigate('camera-scanner')}>
          {t('dashboard.openCameraScanner')}
        </button>
      </div>
      <p className="scanner-dashboard-note">{t('dashboard.scannerNote')}</p>
    </section>
    <div className="dashboard-banners">
      <button type="button" className="code-banner" onClick={() => onNavigate('code-visualizer')}>
        <span className="banner-symbol"><Code2 size={19} /></span>
        <span><small>{t('dashboard.softwareToSilicon')}</small><strong>{t('dashboard.followDigitalWrite')}</strong></span>
        <ArrowRight size={16} />
      </button>
      <button type="button" className="learn-banner" onClick={() => onNavigate('learn-mode')}>
        <BookOpen size={19} />
        <span><small>{t('dashboard.learnBannerEyebrow')}</small><strong>{t('dashboard.exploreFundamentals')}</strong></span>
        <ArrowRight size={15} />
      </button>
    </div>
  </div>
}

function HardwareMonitor({ modes, levels, onSelectPin, serialInfo, physicalPins, wiredPins, firmwareNote, selectedPin, onRefreshStatus, onReadPin }: { modes: Record<string, PinMode>; levels: Record<string, PinLevel>; onSelectPin: (pinId: string) => void; serialInfo: SerialInfo; physicalPins: Record<string, BoardState>; wiredPins: string[]; firmwareNote: string | null; selectedPin: string; onRefreshStatus: () => void; onReadPin: (pinId: string) => void }) {
  const { t } = useTranslation()
  const physicalState = physicalPins[selectedPin] ?? { mode: null, level: null }
  const connected = serialInfo.state === 'connected'

  // Pins whose mode or level just changed flash briefly, so you can see what the board did.
  const [flashing, setFlashing] = useState<string[]>([])
  const previous = useRef<Record<string, BoardState>>({})
  useEffect(() => {
    if (!connected) {
      previous.current = {}
      return
    }
    const changed = Object.keys(physicalPins).filter((id) => {
      const before = previous.current[id]
      return before && (before.mode !== physicalPins[id].mode || before.level !== physicalPins[id].level)
    })
    previous.current = physicalPins
    if (!changed.length) return
    setFlashing(changed)
    const timer = window.setTimeout(() => setFlashing([]), 1100)
    return () => window.clearTimeout(timer)
  }, [physicalPins, connected])

  return <div className="page-stack">
    <div className="page-title-row">
      <div>
        <span className="eyebrow">{t('hardwareMonitor.eyebrow')}</span>
        <h1>{t('hardwareMonitor.title')}</h1>
        <p>{t('hardwareMonitor.subtitle')}</p>
      </div>
      <span className="simulation-tag large"><i /> {serialInfo.state === 'connected' ? `${t('topbar.physical')}: ${t('topbar.connected')}` : `${t('topbar.physical')}: ${t('topbar.disconnected')}`}</span>
    </div>
    <section className="panel hardware-summary-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">CONNECTION</span><h2>{t('hardwareMonitor.usbOverview')}</h2></div>
        <button type="button" className="secondary-button" onClick={onRefreshStatus}>{t('hardwareMonitor.refreshStatus')}</button>
      </div>
      <div className="hardware-summary-grid">
        <div className="hardware-summary-item"><span>{t('hardwareMonitor.connection')}</span><strong>{serialInfo.state === 'connected' ? t('topbar.connected') : serialInfo.state === 'connecting' ? t('topbar.connecting') : serialInfo.state === 'error' ? t('topbar.error') : t('topbar.disconnected')}</strong></div>
        <div className="hardware-summary-item"><span>{t('hardwareMonitor.baud')}</span><strong>{serialInfo.baudRate}</strong></div>
        <div className="hardware-summary-item"><span>{t('hardwareMonitor.selectedPin')}</span><strong>{selectedPin}</strong></div>
        <div className="hardware-summary-item"><span>{t('hardwareMonitor.mode')}</span><strong>{serialInfo.state === 'connected' ? physicalState.mode ?? t('hardwareMonitor.unknown') : t('hardwareMonitor.unknown')}</strong></div>
        <div className="hardware-summary-item"><span>{t('hardwareMonitor.state')}</span><strong>{serialInfo.state === 'connected' ? physicalState.level ?? t('hardwareMonitor.unknown') : t('hardwareMonitor.unknown')}</strong></div>
        <div className="hardware-summary-item"><span>{t('hardwareMonitor.port')}</span><strong>{serialInfo.portName}</strong></div>
      </div>
      {serialInfo.error && <p className="serial-error-message" role="status">{serialInfo.error}</p>}
      {connected && firmwareNote && (
        <div className="firmware-notice" role="alert">
          <strong>Connected, but this board is not running the MicroBoard firmware.</strong>
          <p>
            MicroBoard can only read pin states from a board that answers its <code>STATUS</code> command. {firmwareNote === '(no reply)'
              ? 'This board did not answer at all.'
              : <>This board replied: <code>{firmwareNote.slice(0, 80)}</code>, which looks like another sketch.</>}
          </p>
          <ol>
            <li>Open <code>firmware/microboard_firmware.ino</code> (in the GitHub repo) in the Arduino IDE.</li>
            <li>Select <b>Arduino Uno</b> and this port, then press Upload. This replaces the sketch currently on the board.</li>
            <li>Close the Serial Monitor, come back here and press Connect again.</li>
          </ol>
          <small>Upload your own sketch again afterwards when you want to run it; the monitor only works while the MicroBoard firmware is on the board.</small>
        </div>
      )}
      <div className="command-response-grid">
        <div className="response-box"><span>{t('hardwareMonitor.lastCommand')}</span><strong>{serialInfo.lastCommand || 'None'}</strong></div>
        <div className="response-box"><span>{t('hardwareMonitor.lastResponse')}</span><strong>{serialInfo.lastResponse || t('hardwareMonitor.noResponseYet')}</strong></div>
      </div>
      <div className="hardware-actions">
        <button type="button" className="secondary-button" onClick={() => onReadPin(selectedPin)} disabled={!selectedPin.startsWith('D')}>READ {selectedPin}</button>
        <button type="button" className="primary-button" onClick={onRefreshStatus}>STATUS</button>
      </div>
    </section>
    {[{ label: t('hardwareMonitor.digitalIo'), pins: digitalPins }, { label: t('hardwareMonitor.analogInputs'), pins: analogPins }].map(({ label, pins }) => (
      <section className="panel monitor-panel" key={label}>
        <div className="panel-heading">
          <div><span className="eyebrow">{label}</span><h2>{pins.length} pins</h2></div>
          <span className="monitor-note">{serialInfo.state === 'connected' ? `${t('hardwareMonitor.realBoardState')} · live` : t('hardwareMonitor.simulationValue')}</span>
        </div>
        <div className="monitor-grid">
          {pins.map((item) => {
            const state = serialInfo.state === 'connected' ? (physicalPins[item.id] ?? { mode: null, level: null }) : { mode: modes[item.id], level: levels[item.id] }
            return (
              <button className={`monitor-card${state.level === 'HIGH' ? ' is-high' : ''}${state.level === 'HIGH' && state.mode === 'OUTPUT' ? ' is-driving' : ''}${flashing.includes(item.id) ? ' just-changed' : ''}${connected && wiredPins.includes(item.id) ? ' is-wired' : ''}`} type="button" key={item.id} onClick={() => onSelectPin(item.id)}>
                <div><strong>{item.id}</strong>{connected && wiredPins.includes(item.id) && <em className="wired-badge">WIRED</em>}<i className={state.level === 'HIGH' ? 'active' : ''} /></div>
                <span className="monitor-mcu">{item.mcuPin} <small>BIT {item.bit}</small></span>
                <span className="monitor-mode">{state.mode ?? t('hardwareMonitor.unknown')}</span>
                <small className="monitor-function">{item.functions.join(' · ')}</small>
                <span className={`monitor-level ${state.level === 'HIGH' ? 'high' : ''}`}>{state.level ?? t('hardwareMonitor.unknown')}</span>
              </button>
            )
          })}
        </div>
      </section>
    ))}
  </div>
}

function SettingsPage({ reducedMotion, onChangeMotion, onReset }: { reducedMotion: boolean; onChangeMotion: (value: boolean) => void; onReset: () => void }) {
  const { t } = useTranslation()

  return <div className="page-stack">
    <div className="page-title-row">
      <div>
        <span className="eyebrow">{t('settings.eyebrow')}</span>
        <h1>{t('settings.title')}</h1>
        <p>{t('settings.subtitle')}</p>
      </div>
      <Settings2 className="page-icon" size={22} />
    </div>
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">PREFERENCES</span><h2>{t('settings.workspaceBehavior')}</h2></div>
      </div>
      <div className="setting-row">
        <span><strong>{t('settings.language')}</strong><small>{t('settings.languageNote')}</small></span>
        <LanguageSwitcher />
      </div>
      <label className="setting-row">
        <span><strong>{t('settings.reduceAnimation')}</strong><small>{t('settings.reduceAnimationNote')}</small></span>
        <input type="checkbox" checked={reducedMotion} onChange={(event) => onChangeMotion(event.target.checked)} />
      </label>
      <div className="setting-row">
        <span><strong>{t('settings.hardwareCommunication')}</strong><small>{t('settings.hardwareCommunicationNote')}</small></span>
        <span className="connection-status"><i /> {microBoardSerial.isConnected() ? t('topbar.connected') : t('topbar.disconnected')}</span>
      </div>
      <div className="setting-row">
        <span><strong>{t('settings.resetSimulation')}</strong><small>{t('settings.resetSimulationNote')}</small></span>
        <button type="button" className="secondary-button" onClick={onReset}>{t('settings.resetPins')}</button>
      </div>
    </section>
  </div>
}

export default App