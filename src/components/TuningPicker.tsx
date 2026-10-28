import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId } from '../db/db'
import { INSTRUMENTS, defaultTuning, noteName, tuningLabel, type InstrumentId, type TuningPreset } from '../music/instruments'
import { PromptModal } from './Modal'
import { useToast } from './Toast'

export interface TuningValue {
  instrument: InstrumentId
  tuning: number[]
}

const NOTE_RANGE = Array.from({ length: 60 }, (_, i) => 16 + i) // E0 … D#5

export function TuningPicker({ value, onChange }: { value: TuningValue; onChange: (v: TuningValue) => void }) {
  const { t } = useTranslation()
  const inst = INSTRUMENTS.find((i) => i.id === value.instrument) ?? INSTRUMENTS[0]
  const strings = value.tuning.length
  const toast = useToast()
  const builtIn = inst.tunings[strings] ?? []
  const mine: TuningPreset[] = (useLiveQuery(() => db.tunings.toArray(), []) ?? [])
    .filter((x) => x.notes.length === strings)
    .map((x) => ({ id: x.id, name: x.name, notes: x.notes }))
  const presets = [...builtIn, ...mine]
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const matched = presets.find((p) => p.notes.join() === value.tuning.join())
  const custom = editing || !matched

  const setInstrument = (id: InstrumentId) => {
    const next = INSTRUMENTS.find((i) => i.id === id)!
    const n = next.strings.includes(strings) ? strings : next.strings[0]
    onChange({ instrument: id, tuning: id === 'custom' ? value.tuning.slice(0, n) : defaultTuning(id, n) })
  }

  const setStrings = (n: number) => onChange({ instrument: value.instrument, tuning: defaultTuning(value.instrument, n) })

  const setString = (index: number, midi: number) => {
    const tuning = [...value.tuning]
    tuning[index] = midi
    onChange({ ...value, tuning })
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="field-row">
        <label className="field">
          <span>{t('sheet.instrument')}</span>
          <select className="select" value={value.instrument} onChange={(e) => setInstrument(e.target.value as InstrumentId)}>
            {INSTRUMENTS.map((i) => (
              <option key={i.id} value={i.id}>{t(`instrument.${i.id}`)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('sheet.strings')}</span>
          <select className="select" value={strings} onChange={(e) => setStrings(Number(e.target.value))}>
            {inst.strings.map((n) => (
              <option key={n} value={n}>{t('sheet.stringsN', { count: n })}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
          <span>{t('sheet.tuning')}</span>
          <select
            className="select"
            value={custom ? 'custom' : matched.id}
            onChange={(e) => {
              const p = presets.find((x) => x.id === e.target.value)
              setEditing(!p)
              if (p) onChange({ ...value, tuning: p.notes })
            }}
          >
            {builtIn.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {tuningLabel(p.notes)}</option>
            ))}
            {mine.length > 0 && (
              <optgroup label={t('tuning.mine')}>
                {mine.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {tuningLabel(p.notes)}</option>
                ))}
              </optgroup>
            )}
            <option value="custom">{t('sheet.customTuning')}{custom ? ` — ${tuningLabel(value.tuning)}` : ''}</option>
          </select>
      </label>
      {custom && (
        <div className="tuning-strings" style={{ '--n': strings } as CSSProperties}>
          {/* Shown lowest string first, the way players name tunings. */}
          {value.tuning
            .map((midi, i) => ({ midi, i }))
            .reverse()
            .map(({ midi, i }) => (
              <label key={i}>
                {i + 1}
                <select className="select" value={midi} onChange={(e) => setString(i, Number(e.target.value))}>
                  {NOTE_RANGE.map((n) => (
                    <option key={n} value={n}>{noteName(n, true)}</option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      )}
      {custom && !matched && (
        <div>
          <button className="btn" onClick={() => setSaving(true)}>{t('tuning.save')}</button>
        </div>
      )}
      <PromptModal
        open={saving}
        title={t('tuning.saveTitle')}
        placeholder={t('tuning.namePlaceholder')}
        confirmLabel={t('common.save')}
        cancelLabel={t('common.cancel')}
        onClose={() => setSaving(false)}
        onSubmit={async (name) => {
          setSaving(false)
          const now = Date.now()
          await db.tunings.add({ id: newId(), name, notes: value.tuning, createdAt: now, updatedAt: now })
          setEditing(false)
          toast(t('tuning.saved'))
        }}
      />
    </div>
  )
}
