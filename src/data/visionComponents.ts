// Maps a camera-detected class name to MicroBoard component information. Only existing data is used:
// the supplied components manifest (category + description), the Learn Mode lesson library and the
// build-inventory catalog. Classes without an entry there get no invented details.
import manifestData from './componentManifest.json'
import type { ComponentProfileId } from './componentCatalog'
import type { LessonComponentId } from './componentLessons'

type ManifestEntry = { classId: number; name: string; category: string; description: string }

const MANIFEST = new Map((manifestData.components as ManifestEntry[]).map((entry) => [entry.name, entry]))

// Class names used by the older 2-class board model, mapped to the manifest taxonomy.
const LEGACY_ALIASES: Record<string, string> = {
  esp8266_nodemcu: 'NodeMCU_ESP8266',
}

// Manifest class → Learn Mode lesson.
const LESSONS: Record<string, LessonComponentId> = {
  Arduino_Uno: 'arduino_uno', Breadboard: 'breadboard', HC_SR04: 'ultrasonic',
  DHT11: 'dht', DHT22: 'dht', DHT12: 'dht', MPU6050: 'mpu6050', GY521: 'mpu6050',
  LDR: 'ldr', LDR_Module: 'ldr', PIR_Sensor: 'pir', HC_SR501_PIR: 'pir', PIR_HC_SR501: 'pir', PIR_HC_SR505: 'pir',
  LCD_16x2: 'lcd', I2C_LCD_Backpack: 'lcd', LCD_20x4: 'lcd',
  RGB_LED: 'led', LED_Red: 'led', LED_Green: 'led', LED_Blue: 'led', LED_Yellow: 'led', LED_White: 'led', LED_5mm: 'led', LED_3mm: 'led',
  Buzzer: 'buzzer', Active_Buzzer: 'buzzer', Passive_Buzzer: 'buzzer',
  Potentiometer: 'potentiometer', Push_Button: 'push_button',
  SG90_Servo: 'servo', MG996R_Servo: 'servo',
  Relay_Module: 'relay', Relay_5V: 'relay', Relay_2Channel: 'relay', Relay_4Channel: 'relay',
  Resistor: 'resistor', ESP8266_Module: 'esp8266', NodeMCU_ESP8266: 'esp8266',
  Jumper_Wires: 'jumper_wire', Dupont_Male_Male: 'jumper_wire', Dupont_Male_Female: 'jumper_wire', Dupont_Female_Female: 'jumper_wire',
}

// Manifest class → build-inventory catalog part (used by the Board Designer).
const CATALOG: Record<string, ComponentProfileId> = {
  Arduino_Uno: 'arduino_uno', Breadboard: 'breadboard', NodeMCU_ESP8266: 'esp8266_nodemcu',
  RGB_LED: 'led', LED_Red: 'led', LED_Green: 'led', LED_Blue: 'led', LED_Yellow: 'led', LED_White: 'led', LED_5mm: 'led', LED_3mm: 'led',
  Resistor: 'resistor', Push_Button: 'push_button', Potentiometer: 'potentiometer',
  Jumper_Wires: 'jumper_wire', Dupont_Male_Male: 'jumper_wire', Dupont_Male_Female: 'jumper_wire', Dupont_Female_Female: 'jumper_wire',
  other_board: 'other_board',
}

export type VisionComponentInfo = {
  /** Class name as used in the manifest (or the model's own name when it has no manifest entry). */
  name: string
  category: string | null
  description: string | null
  lessonId: LessonComponentId | null
  catalogProfileId: ComponentProfileId | null
}

export function visionComponentInfo(className: string): VisionComponentInfo {
  const name = LEGACY_ALIASES[className] ?? className
  const entry = MANIFEST.get(name)
  return {
    name,
    category: entry?.category ?? null,
    description: entry?.description ?? null,
    lessonId: LESSONS[name] ?? null,
    catalogProfileId: CATALOG[name] ?? CATALOG[className] ?? null,
  }
}
