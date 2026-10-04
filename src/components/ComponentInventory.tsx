import { useState } from 'react'
import { Check, Minus, Plus, ShieldCheck } from 'lucide-react'
import { COMPONENT_PROFILES, COMPONENT_PROFILE_IDS, getComponentProfile, type ComponentProfileId } from '../data/componentCatalog'
import type { Detection } from '../ml/detector'
import './ComponentInventory.css'

export type ResistorValues = Record<string, string>

type ComponentInventoryProps = {
  items: Detection[]
  selectedId: string | null
  resistorValues: ResistorValues
  onSelect: (item: Detection) => void
  onAdd: (profileId: ComponentProfileId) => void
  onChangeClass: (item: Detection, profileId: ComponentProfileId) => void
  onConfirm: (item: Detection) => void
  onRemove: (item: Detection) => void
  onResistorValueChange: (item: Detection, value: string) => void
}

export function ComponentInventory({
  items,
  selectedId,
  resistorValues,
  onSelect,
  onAdd,
  onChangeClass,
  onConfirm,
  onRemove,
  onResistorValueChange,
}: ComponentInventoryProps) {
  const [profileToAdd, setProfileToAdd] = useState<ComponentProfileId>('led')
  const selected = items.find((item) => item.id === selectedId) ?? null
  const selectedProfile = selected ? getComponentProfileById(selected.className) : undefined
  const counts = items.reduce<Record<string, number>>((result, item) => {
    result[item.className] = (result[item.className] ?? 0) + 1
    return result
  }, {})

  return (
    <section className="panel build-inventory-panel" aria-label="Build inventory">
      <div className="panel-heading">
        <div><span className="eyebrow">USER-REVIEWED PARTS</span><h2>Build Inventory</h2></div>
        <span className="inventory-count">{items.length} ITEM{items.length === 1 ? '' : 'S'}</span>
      </div>
      <div className="inventory-mode-note"><ShieldCheck size={14} /><span>Confirm detections yourself. Manual parts are never shown as AI results.</span></div>

      <div className="inventory-summary-list">
        {Object.entries(counts).map(([id, count]) => {
          const profile = getComponentProfile(id as ComponentProfileId)
          return <span className="inventory-summary-item" key={id}>{profile.name}<b>×{count}</b></span>
        })}
        {!items.length && <p className="inventory-empty">No confirmed parts yet. Add parts manually or review camera detections above.</p>}
      </div>

      <div className="inventory-add-row">
        <label htmlFor="manual-component-select">MANUAL COMPONENT MODE</label>
        <div>
          <select id="manual-component-select" value={profileToAdd} onChange={(event) => setProfileToAdd(event.target.value as ComponentProfileId)}>
            {COMPONENT_PROFILE_IDS.map((id) => <option value={id} key={id}>{COMPONENT_PROFILES[id].name}</option>)}
          </select>
          <button type="button" className="secondary-button" onClick={() => onAdd(profileToAdd)}><Plus size={14} /> ADD MANUAL</button>
        </div>
      </div>

      <div className="inventory-items">
        {items.map((item) => {
          const profile = getComponentProfile(item.className as ComponentProfileId)
          return (
            <article className={`inventory-item ${selectedId === item.id ? 'is-selected' : ''}`} key={item.id}>
              <button type="button" className="inventory-item-select" onClick={() => onSelect(item)} aria-pressed={selectedId === item.id}>
                <span><strong>{profile.name}</strong><small>{profile.category} · {item.source.toUpperCase()}</small></span>
                {item.source === 'camera' && <b className="inventory-confidence">{Math.round(item.confidence * 100)}%</b>}
              </button>
              <div className="inventory-item-controls">
                <label className="sr-only" htmlFor={`component-class-${item.id}`}>Correct component class</label>
                <select id={`component-class-${item.id}`} value={item.className} onChange={(event) => onChangeClass(item, event.target.value as ComponentProfileId)}>
                  {COMPONENT_PROFILE_IDS.map((id) => <option value={id} key={id}>{COMPONENT_PROFILES[id].name}</option>)}
                </select>
                <button type="button" className="inventory-icon-button" onClick={() => onRemove(item)} aria-label={`Remove ${profile.name}`} title="Remove item"><Minus size={14} /></button>
                <button type="button" className="inventory-icon-button" onClick={() => onAdd(item.className as ComponentProfileId)} aria-label={`Add another ${profile.name}`} title="Add another"><Plus size={14} /></button>
                <button type="button" className={`inventory-confirm-button ${item.confirmed ? 'is-confirmed' : ''}`} onClick={() => onConfirm(item)} disabled={item.confirmed}>
                  {item.confirmed ? <><Check size={13} /> CONFIRMED</> : 'CONFIRM'}
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {selected && selectedProfile && (
        <section className="component-detail-panel" aria-label={`${selectedProfile.name} details`}>
          <div className="panel-heading"><div><span className="eyebrow">COMPONENT DETAILS</span><h3>{selectedProfile.name}</h3></div><span className={`component-source-tag ${selected.source}`}>{selected.source.toUpperCase()}</span></div>
          <p>{selectedProfile.description}</p>
          <dl className="component-detail-list">
            <div><dt>Type</dt><dd>{selectedProfile.category}</dd></div>
            <div><dt>Pins</dt><dd>{selectedProfile.typicalPins.join(' · ') || 'Not specified'}</dd></div>
            {selectedProfile.mcu && <div><dt>MCU</dt><dd>{selectedProfile.mcu}</dd></div>}
          </dl>
          {selectedProfile.id === 'resistor' && (
            <label className="resistor-value-field">Resistance value (Ω)
              <input type="number" min="1" step="1" list="standard-resistor-values" placeholder="Unknown" value={resistorValues[selected.id] ?? ''} onChange={(event) => onResistorValueChange(selected, event.target.value)} />
              <datalist id="standard-resistor-values"><option value="220" /><option value="330" /><option value="1000" /><option value="10000" /></datalist>
            </label>
          )}
          <div className="component-guidance">
            <strong>DESIGN GUIDANCE</strong>
            {selectedProfile.designHints.map((hint) => <p key={hint}>{hint}</p>)}
            {selectedProfile.electricalNotes.map((note) => <p className="electrical-note" key={note}>{note}</p>)}
          </div>
        </section>
      )}
    </section>
  )
}

function getComponentProfileById(id: string) {
  return Object.values(COMPONENT_PROFILES).find((profile) => profile.id === id)
}
