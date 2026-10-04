import { digitalPins, getPin, type PinDefinition } from '../data/pins'
import type { ComponentProfileId } from '../data/componentCatalog'
import type { Detection } from '../ml/detector'

export type PinRole = 'led' | 'button'
export type PinAssignments = Partial<Record<PinRole, string>>

export type PinConflict = {
  pinId: string
  componentNames: string[]
}

export type SuggestedConnection = {
  id: string
  text: string
  pinId?: string
}

export type DesignAnalysis = {
  conflicts: PinConflict[]
  suggestions: SuggestedConnection[]
  warnings: string[]
  canAccept: boolean
  generatedCode: string
}

function hasConfirmed(items: Detection[], componentId: ComponentProfileId): boolean {
  return items.some((item) => item.confirmed && item.className === componentId)
}

export function getAvailableDigitalPins(role: PinRole, currentPin: string, assignments: PinAssignments): PinDefinition[] {
  const taken = new Set(Object.entries(assignments).filter(([assignedRole]) => assignedRole !== role).map(([, pinId]) => pinId))
  return digitalPins.filter((pin) => pin.id === currentPin || (!taken.has(pin.id) && pin.functions.includes('Digital I/O')))
}

export function suggestAlternativePins(role: PinRole, currentPin: string, assignments: PinAssignments): PinDefinition[] {
  return getAvailableDigitalPins(role, currentPin, assignments)
    .filter((pin) => pin.id !== currentPin)
    .sort((first, second) => {
      const rank = (pin: PinDefinition) => {
        const uartPenalty = pin.peripherals.includes('UART') ? 3 : 0
        const roleCapability = role === 'button'
          ? (pin.peripherals.includes('Interrupts') ? 0 : 1)
          : (pin.peripherals.includes('PWM') ? 0 : 1)
        return uartPenalty + roleCapability
      }
      return rank(first) - rank(second)
    })
    .slice(0, 3)
}

export function analyzeBoardDesign(
  items: Detection[],
  assignments: PinAssignments,
  resistorValues: Record<string, string>,
): DesignAnalysis {
  const hasUno = hasConfirmed(items, 'arduino_uno')
  const hasLed = hasConfirmed(items, 'led')
  const hasButton = hasConfirmed(items, 'push_button')
  const hasResistor = items.some((item) => item.confirmed && item.className === 'resistor' && Number(resistorValues[item.id]) > 0)
  const claims = [
    ...(hasLed && assignments.led ? [{ role: 'LED', pinId: assignments.led }] : []),
    ...(hasButton && assignments.button ? [{ role: 'Push Button', pinId: assignments.button }] : []),
  ]
  const conflicts = [...new Set(claims.map((claim) => claim.pinId))]
    .map((pinId) => ({ pinId, componentNames: claims.filter((claim) => claim.pinId === pinId).map((claim) => claim.role) }))
    .filter((conflict) => conflict.componentNames.length > 1)

  const warnings: string[] = []
  if (!hasUno) warnings.push('Confirm an Arduino Uno R3 in the inventory before using the Uno pin map.')
  if (hasLed && !hasResistor) warnings.push('LED design needs a confirmed resistor with a known value. Never connect an LED directly between a GPIO and ground.')
  if (hasLed && hasResistor) warnings.push('GPIO current limits and resistor power rating have not been electrically validated.')
  if (hasButton) warnings.push('Button uses INPUT_PULLUP; wire the switch between the selected pin and GND.')
  if (conflicts.length) warnings.push('Resolve pin conflicts before accepting this design.')

  const suggestions: SuggestedConnection[] = []
  if (hasLed && assignments.led) {
    const pin = getPin(assignments.led)
    const resistance = items.find((item) => item.confirmed && item.className === 'resistor' && Number(resistorValues[item.id]) > 0)
    const resistorText = resistance ? `${resistorValues[resistance.id]} Ω resistor` : 'resistor value required'
    suggestions.push({ id: 'led-path', pinId: assignments.led, text: `${pin.id} → ${resistorText} → LED Anode → LED Cathode → GND` })
  }
  if (hasButton && assignments.button) {
    const pin = getPin(assignments.button)
    suggestions.push({ id: 'button-path', pinId: assignments.button, text: `${pin.id} → Push Button → GND (INPUT_PULLUP)` })
  }

  const setup: string[] = []
  if (hasLed && assignments.led) setup.push(`  pinMode(${Number(assignments.led.slice(1))}, OUTPUT);`)
  if (hasButton && assignments.button) setup.push(`  pinMode(${Number(assignments.button.slice(1))}, INPUT_PULLUP);`)
  const loop: string[] = []
  if (hasLed && assignments.led) loop.push(`  digitalWrite(${Number(assignments.led.slice(1))}, HIGH);`)
  if (hasButton && assignments.button) loop.push(`  // Read digitalRead(${Number(assignments.button.slice(1))}) to detect a pressed button.`)
  const generatedCode = `void setup() {\n${setup.join('\n')}\n}\n\nvoid loop() {\n${loop.join('\n')}\n}`
  const canAccept = hasUno && !conflicts.length && (!hasLed || hasResistor) && suggestions.length > 0

  return { conflicts, suggestions, warnings, canAccept, generatedCode }
}
