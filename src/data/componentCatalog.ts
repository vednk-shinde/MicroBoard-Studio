export type ComponentProfileId =
  | 'esp8266_nodemcu'
  | 'other_board'
  | 'arduino_uno'
  | 'breadboard'
  | 'led'
  | 'resistor'
  | 'push_button'
  | 'potentiometer'
  | 'jumper_wire'

export type ComponentCategory = 'board' | 'prototyping' | 'output' | 'passive' | 'input' | 'connection' | 'unknown'

export type ComponentProfile = {
  id: ComponentProfileId
  classId: number
  name: string
  category: ComponentCategory
  description: string
  typicalPins: string[]
  electricalNotes: string[]
  supportedBoards: string[]
  designHints: string[]
  mcu?: string
  platform?: string
}

export const COMPONENT_PROFILES: Record<ComponentProfileId, ComponentProfile> = {
  esp8266_nodemcu: {
    id: 'esp8266_nodemcu',
    classId: 0,
    name: 'ESP8266 NodeMCU',
    category: 'board',
    description: 'Wi-Fi enabled development board based on the ESP8266.',
    typicalPins: ['3V3', 'GND', 'GPIO'],
    electricalNotes: ['GPIO is 3.3 V logic; do not assume 5 V tolerance.'],
    supportedBoards: ['esp8266_nodemcu'],
    designHints: ['Confirm board pin labels and voltage before wiring.'],
    mcu: 'ESP8266',
    platform: 'NodeMCU',
  },
  other_board: {
    id: 'other_board',
    classId: 1,
    name: 'Other board',
    category: 'board',
    description: 'The current board detector cannot identify this board more specifically.',
    typicalPins: [],
    electricalNotes: ['Identify its logic voltage and pinout before connecting components.'],
    supportedBoards: [],
    designHints: ['Select the correct board profile manually before assigning pins.'],
  },
  arduino_uno: {
    id: 'arduino_uno',
    classId: 2,
    name: 'Arduino Uno R3',
    category: 'board',
    description: 'Uno-compatible development board using the ATmega328P pin mapping.',
    typicalPins: ['D0–D13', 'A0–A5', '5V', '3V3', 'GND'],
    electricalNotes: ['GPIO current and board supply limits still apply.'],
    supportedBoards: ['arduino_uno'],
    designHints: ['Use the existing Uno pin map for signal assignments.'],
    mcu: 'ATmega328P',
    platform: 'Arduino',
  },
  breadboard: {
    id: 'breadboard',
    classId: 3,
    name: 'Breadboard',
    category: 'prototyping',
    description: 'Solderless prototyping board with internally connected contact strips.',
    typicalPins: ['Terminal strips', 'Power rails'],
    electricalNotes: ['Check the breadboard rail breaks and row connectivity.'],
    supportedBoards: ['arduino_uno', 'esp8266_nodemcu'],
    designHints: ['Place each lead in a separate connected row as required by the circuit.'],
  },
  led: {
    id: 'led',
    classId: 4,
    name: 'LED',
    category: 'output',
    description: 'Polarized light-emitting diode.',
    typicalPins: ['Anode', 'Cathode'],
    electricalNotes: ['Polarity matters.', 'Use a current-limiting resistor in series.'],
    supportedBoards: ['arduino_uno', 'esp8266_nodemcu'],
    designHints: ['Use a current-limiting resistor.', 'Do not connect directly between power and ground.'],
  },
  resistor: {
    id: 'resistor',
    classId: 5,
    name: 'Resistor',
    category: 'passive',
    description: 'Two-terminal component that limits current or forms a divider.',
    typicalPins: ['Terminal 1', 'Terminal 2'],
    electricalNotes: ['Resistance value and power rating are required for circuit calculations.'],
    supportedBoards: ['arduino_uno', 'esp8266_nodemcu'],
    designHints: ['Enter the resistance value; camera imagery is not used to estimate it.'],
  },
  push_button: {
    id: 'push_button',
    classId: 6,
    name: 'Push Button',
    category: 'input',
    description: 'Momentary mechanical switch.',
    typicalPins: ['Switch terminal 1', 'Switch terminal 2'],
    electricalNotes: ['A four-leg tactile switch often has paired legs internally connected.'],
    supportedBoards: ['arduino_uno', 'esp8266_nodemcu'],
    designHints: ['Can use INPUT_PULLUP with the switch connected to ground.'],
  },
  potentiometer: {
    id: 'potentiometer',
    classId: 7,
    name: 'Potentiometer',
    category: 'input',
    description: 'Three-terminal adjustable voltage divider.',
    typicalPins: ['VCC', 'GND', 'SIGNAL'],
    electricalNotes: ['Use a supply compatible with the selected board input range.'],
    supportedBoards: ['arduino_uno', 'esp8266_nodemcu'],
    designHints: ['Connect the wiper to an analog input when reading position.'],
  },
  jumper_wire: {
    id: 'jumper_wire',
    classId: 8,
    name: 'Jumper Wire',
    category: 'connection',
    description: 'Wire used to connect breadboard rows, rails, and board pins.',
    typicalPins: ['End 1', 'End 2'],
    electricalNotes: ['A wire connects nodes; it does not limit current.'],
    supportedBoards: ['arduino_uno', 'esp8266_nodemcu'],
    designHints: ['Keep signal and ground connections distinct.'],
  },
}

export const COMPONENT_PROFILE_IDS = Object.keys(COMPONENT_PROFILES) as ComponentProfileId[]
export const COMPONENT_CLASS_NAMES = COMPONENT_PROFILE_IDS.map((id) => id) as readonly ComponentProfileId[]

export function getComponentProfile(id: ComponentProfileId): ComponentProfile {
  return COMPONENT_PROFILES[id]
}

export function getComponentProfileByClassId(classId: number): ComponentProfile | undefined {
  return Object.values(COMPONENT_PROFILES).find((profile) => profile.classId === classId)
}
