import { useState } from 'react'
import { COMPONENT_PROFILES, type ComponentProfileId } from '../data/componentCatalog'
import type { Detection } from '../ml/detector'
import { BoardDesigner } from './BoardDesigner'
import { ComponentInventory, type ResistorValues } from './ComponentInventory'
import { DetectedComponentsPanel } from './DetectedComponentsPanel'

type ClassCorrection = {
  classId: number
  className: ComponentProfileId
}

export function ComponentWorkspace({ detections, onOpenCodeVisualizer }: {
  detections: Detection[]
  onOpenCodeVisualizer: (code: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [manualItems, setManualItems] = useState<Detection[]>([])
  const [corrections, setCorrections] = useState<Record<string, ClassCorrection>>({})
  const [confirmedIds, setConfirmedIds] = useState<string[]>([])
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [resistorValues, setResistorValues] = useState<ResistorValues>({})
  const [nextManualId, setNextManualId] = useState(1)

  const cameraDetections = detections.filter((item) => !removedIds.includes(item.id))
  const editableCameraItems = cameraDetections.map((item) => {
    const correction = corrections[item.id]
    const profile = correction ? COMPONENT_PROFILES[correction.className] : undefined
    return {
      ...item,
      ...(profile ? { classId: profile.classId, className: profile.id, label: profile.id } : {}),
      confirmed: confirmedIds.includes(item.id),
    }
  })
  const inventory = [...editableCameraItems, ...manualItems]

  function addManual(profileId: ComponentProfileId) {
    const profile = COMPONENT_PROFILES[profileId]
    const id = `manual-${profileId}-${nextManualId}`
    const emptyBox = { x: 0, y: 0, width: 0, height: 0 }
    const item: Detection = {
      id,
      classId: profile.classId,
      className: profile.id,
      label: profile.id,
      confidence: 1,
      boundingBox: emptyBox,
      bbox: emptyBox,
      center: { x: 0, y: 0 },
      source: 'manual',
      confirmed: false,
    }
    setManualItems((current) => [...current, item])
    setNextManualId((current) => current + 1)
    setSelectedId(id)
  }

  function changeClass(item: Detection, profileId: ComponentProfileId) {
    const profile = COMPONENT_PROFILES[profileId]
    if (item.source === 'camera') {
      setCorrections((current) => ({ ...current, [item.id]: { classId: profile.classId, className: profileId } }))
      setConfirmedIds((current) => current.filter((id) => id !== item.id))
      return
    }
    setManualItems((current) => current.map((manual) => manual.id === item.id
      ? { ...manual, classId: profile.classId, className: profileId, label: profileId, confirmed: false }
      : manual))
  }

  function confirm(item: Detection) {
    setConfirmedIds((current) => current.includes(item.id) ? current : [...current, item.id])
    setManualItems((current) => current.map((manual) => manual.id === item.id ? { ...manual, confirmed: true } : manual))
  }

  function remove(item: Detection) {
    if (item.source === 'camera') {
      setRemovedIds((current) => current.includes(item.id) ? current : [...current, item.id])
    } else {
      setManualItems((current) => current.filter((manual) => manual.id !== item.id))
    }
    if (selectedId === item.id) setSelectedId(null)
  }

  function updateResistorValue(item: Detection, value: string) {
    setResistorValues((current) => ({ ...current, [item.id]: value }))
  }

  return (
    <div className="component-workspace">
      <DetectedComponentsPanel detections={cameraDetections} selectedId={selectedId} onSelect={(item) => setSelectedId(item.id)} />
      <ComponentInventory
        items={inventory}
        selectedId={selectedId}
        resistorValues={resistorValues}
        onSelect={(item) => setSelectedId(item.id)}
        onAdd={addManual}
        onChangeClass={changeClass}
        onConfirm={confirm}
        onRemove={remove}
        onResistorValueChange={updateResistorValue}
      />
      <BoardDesigner inventory={inventory} resistorValues={resistorValues} onAccept={onOpenCodeVisualizer} />
    </div>
  )
}
