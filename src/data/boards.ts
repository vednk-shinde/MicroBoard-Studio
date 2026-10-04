export type BoardProfile = {
  id: string
  name: string
  manufacturer: string
  mcu: string
  pinProfile: string
}

export const boardProfiles: BoardProfile[] = [
  {
    id: 'arduino_uno',
    name: 'Arduino Uno R3',
    manufacturer: 'Arduino',
    mcu: 'ATmega328P',
    pinProfile: 'arduino_uno',
  },
  {
    id: 'esp8266_nodemcu',
    name: 'ESP8266 NodeMCU',
    manufacturer: 'NodeMCU',
    mcu: 'ESP8266',
    pinProfile: 'esp8266_nodemcu',
  },
]

export function getBoardProfile(id?: string | null): BoardProfile | undefined {
  if (!id) return undefined
  return boardProfiles.find((board) => board.id === id)
}

export function getBoardFromDetection(classId?: string | null): BoardProfile | undefined {
  return getBoardProfile(classId)
}
