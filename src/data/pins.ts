export type PeripheralName = 'UART' | 'SPI' | 'I2C' | 'PWM' | 'ADC' | 'Interrupts'
export type PinMode = 'INPUT' | 'INPUT_PULLUP' | 'OUTPUT'
export type PinLevel = 'LOW' | 'HIGH'

export interface PinDefinition {
  id: string
  family: 'Digital' | 'Analog'
  mcuPin: string
  port: 'B' | 'C' | 'D'
  bit: number
  functions: string[]
  peripherals: PeripheralName[]
}

export const peripheralNames: PeripheralName[] = ['UART', 'SPI', 'I2C', 'PWM', 'ADC', 'Interrupts']

export const pinMap: PinDefinition[] = [
  { id: 'D0', family: 'Digital', mcuPin: 'PD0', port: 'D', bit: 0, functions: ['Digital I/O', 'UART RX'], peripherals: ['UART'] },
  { id: 'D1', family: 'Digital', mcuPin: 'PD1', port: 'D', bit: 1, functions: ['Digital I/O', 'UART TX'], peripherals: ['UART'] },
  { id: 'D2', family: 'Digital', mcuPin: 'PD2', port: 'D', bit: 2, functions: ['Digital I/O', 'INT0'], peripherals: ['Interrupts'] },
  { id: 'D3', family: 'Digital', mcuPin: 'PD3', port: 'D', bit: 3, functions: ['Digital I/O', 'PWM', 'INT1'], peripherals: ['PWM', 'Interrupts'] },
  { id: 'D4', family: 'Digital', mcuPin: 'PD4', port: 'D', bit: 4, functions: ['Digital I/O'], peripherals: [] },
  { id: 'D5', family: 'Digital', mcuPin: 'PD5', port: 'D', bit: 5, functions: ['Digital I/O', 'PWM'], peripherals: ['PWM'] },
  { id: 'D6', family: 'Digital', mcuPin: 'PD6', port: 'D', bit: 6, functions: ['Digital I/O', 'PWM'], peripherals: ['PWM'] },
  { id: 'D7', family: 'Digital', mcuPin: 'PD7', port: 'D', bit: 7, functions: ['Digital I/O'], peripherals: [] },
  { id: 'D8', family: 'Digital', mcuPin: 'PB0', port: 'B', bit: 0, functions: ['Digital I/O'], peripherals: [] },
  { id: 'D9', family: 'Digital', mcuPin: 'PB1', port: 'B', bit: 1, functions: ['Digital I/O', 'PWM'], peripherals: ['PWM'] },
  { id: 'D10', family: 'Digital', mcuPin: 'PB2', port: 'B', bit: 2, functions: ['Digital I/O', 'PWM', 'SPI SS'], peripherals: ['PWM', 'SPI'] },
  { id: 'D11', family: 'Digital', mcuPin: 'PB3', port: 'B', bit: 3, functions: ['Digital I/O', 'PWM', 'SPI MOSI'], peripherals: ['PWM', 'SPI'] },
  { id: 'D12', family: 'Digital', mcuPin: 'PB4', port: 'B', bit: 4, functions: ['Digital I/O', 'SPI MISO'], peripherals: ['SPI'] },
  { id: 'D13', family: 'Digital', mcuPin: 'PB5', port: 'B', bit: 5, functions: ['Digital I/O', 'SPI SCK', 'Built-in LED'], peripherals: ['SPI'] },
  { id: 'A0', family: 'Analog', mcuPin: 'PC0', port: 'C', bit: 0, functions: ['ADC0'], peripherals: ['ADC'] },
  { id: 'A1', family: 'Analog', mcuPin: 'PC1', port: 'C', bit: 1, functions: ['ADC1'], peripherals: ['ADC'] },
  { id: 'A2', family: 'Analog', mcuPin: 'PC2', port: 'C', bit: 2, functions: ['ADC2'], peripherals: ['ADC'] },
  { id: 'A3', family: 'Analog', mcuPin: 'PC3', port: 'C', bit: 3, functions: ['ADC3'], peripherals: ['ADC'] },
  { id: 'A4', family: 'Analog', mcuPin: 'PC4', port: 'C', bit: 4, functions: ['ADC4', 'I2C SDA'], peripherals: ['ADC', 'I2C'] },
  { id: 'A5', family: 'Analog', mcuPin: 'PC5', port: 'C', bit: 5, functions: ['ADC5', 'I2C SCL'], peripherals: ['ADC', 'I2C'] },
]

export const digitalPins = pinMap.filter((pin) => pin.family === 'Digital')
export const analogPins = pinMap.filter((pin) => pin.family === 'Analog')

export function getPin(pinId: string): PinDefinition {
  return pinMap.find((pin) => pin.id === pinId) ?? pinMap[13]
}

export function getPinByArduinoNumber(number: number): PinDefinition | undefined {
  return digitalPins.find((pin) => Number(pin.id.slice(1)) === number)
}

export function pinForPortBit(port: PinDefinition['port'], bit: number): PinDefinition | undefined {
  return pinMap.find((pin) => pin.port === port && pin.bit === bit)
}