// Finds which digital pins have something wired to them, using only the existing serial commands
// (MODE / READ), so the board does not need new firmware.
//
// Method: set a pin to INPUT_PULLUP (a weak internal pull-up to 5 V) and read it. If nothing is attached, the pin
// reads HIGH. If a wire to GND, an LED + resistor, a motor coil, a pressed button, or a sensor output that is low
// holds it down, it reads LOW. Limits: a pin wired to something that drives it HIGH (or a pull-up module such as a
// DHT11) reads HIGH just like an empty pin, so it is not found. D0/D1 (USB serial) and pins currently set to OUTPUT
// are not scanned. Each pin is put back to its previous input mode afterwards.

export const SCAN_PIN_NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]

const READ_REPLY = /^READ (\d+) (INPUT|INPUT_PULLUP|OUTPUT) (HIGH|LOW)$/

export type PinScanResult = {
  /** Pins that read LOW with the pull-up on: something is holding them down. */
  wired: string[]
  /** Pins that were not scanned (currently OUTPUT). */
  skipped: string[]
}

export async function scanWiredPins(
  send: (command: string) => Promise<string>,
  statuses: Record<string, { mode: string | null }>,
): Promise<PinScanResult> {
  const wired: string[] = []
  const skipped: string[] = []
  for (const number of SCAN_PIN_NUMBERS) {
    const id = `D${number}`
    const original = statuses[id]?.mode
    if (original === 'OUTPUT') {
      skipped.push(id)
      continue
    }
    const restore = original === 'INPUT_PULLUP' ? 'INPUT_PULLUP' : 'INPUT'
    try {
      await send(`MODE ${number} INPUT_PULLUP`)
      await new Promise((resolve) => window.setTimeout(resolve, 15))
      const match = (await send(`READ ${number}`)).trim().match(READ_REPLY)
      if (match && Number(match[1]) === number && match[3] === 'LOW') wired.push(id)
    } finally {
      await send(`MODE ${number} ${restore}`).catch(() => undefined)
    }
  }
  return { wired, skipped }
}
