import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { flushPendingSaves } from '../lib/pendingSaves'
import { db, SHEET_TYPES, type SheetType } from '../db/db'
import { deleteSheet, switchSheetType, updateSheet } from '../db/repo'
import { Icon } from '../components/Icon'
import { ConfirmModal } from '../components/Modal'
import { AddToSongbookDialog } from '../components/AddToSongbookDialog'
import { ImageSheetPage } from './ImageSheetPage'
import { ChordChartWorkspace } from '../components/ChordChartWorkspace'
import { MelodyWorkspace } from '../components/MelodyWorkspace'
import { TabWorkspace } from '../components/TabWorkspace'
import { useToast } from '../components/Toast'
import { SourceImagePanel } from '../components/SourceImagePanel'
import { TuningPicker } from '../components/TuningPicker'
import { KEYS } from '../music/chords'
import { sheetFrets, tuningLabel } from '../music/instruments'
import { MAX_FRET, MIN_FRETS, TIME_SIGNATURES } from '../music/tab'
import { useSheetInfoOpen, useSourcePanel } from '../lib/settings'


export function SheetPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const { id } = useParams()
  // `null` once loaded and missing, `undefined` while loading.
  const sheet = useLiveQuery(async () => (await db.sheets.get(id!)) ?? null, [id])
  const sections = useLiveQuery(() => db.sections.orderBy('order').toArray(), []) ?? []
  const [deleting, setDeleting] = useState(false)
  const [toSongbook, setToSongbook] = useState(false)
  const [tagsDraft, setTagsDraft] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useSheetInfoOpen()
  const [sourceMode] = useSourcePanel()

  if (sheet === undefined) return null
  if (sheet === null)
    return (
      <div className="page">
        <div className="empty"><h2>{t('sheet.notFound')}</h2></div>
      </div>
    )

  // Picture / PDF sheets have their own read-only page.
  if (sheet.type === 'image') return <ImageSheetPage sheet={sheet} sections={sections} />

  const save = (changes: Parameters<typeof updateSheet>[1]) => void updateSheet(sheet.id, changes)
  const commitTags = () => {
    if (tagsDraft === null) return
    save({ tags: [...new Set(tagsDraft.split(/[,，]/).map((x) => x.trim()).filter(Boolean))] })
    setTagsDraft(null)
  }

  return (
    <div className={`page${sheet.sourceImageId && sourceMode === 'side' ? ' with-source' : ''}`}>
      {sheet.sourceImageId && <SourceImagePanel imageIds={sheet.sourceImageIds ?? [sheet.sourceImageId]} />}
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label={t('common.back')} title={t('common.back')}>
          <Icon name="back" />
        </button>
        <input
          className="input"
          style={{ flex: 1, fontSize: '1.4rem', fontWeight: 700, border: 'none', padding: '4px 0', background: 'transparent' }}
          aria-label={t('sheet.title')}
          defaultValue={sheet.title}
          key={sheet.id}
          onBlur={(e) => e.target.value.trim() && e.target.value !== sheet.title && save({ title: e.target.value.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button className="btn" title={t('songbook.addToTitle')} onClick={() => setToSongbook(true)}>
          <Icon name="book" />
          <span className="hide-narrow">{t('songbook.addTo')}</span>
        </button>
        <button className="btn" title={t('pdf.exportTitle')} onClick={() => void flushPendingSaves().then(() => navigate(`/sheet/${sheet.id}/pdf`))}>
          <Icon name="download" />
          <span className="hide-narrow">{t('pdf.export')}</span>
        </button>
        <button className="btn btn-ghost btn-icon" aria-label={t('common.delete')} title={t('common.delete')} onClick={() => setDeleting(true)}>
          <Icon name="trash" />
        </button>
      </div>

      <section className="panel details">
        <button
          className="details-toggle"
          aria-expanded={infoOpen}
          aria-controls="sheet-details"
          title={infoOpen ? t('sheet.hideDetails') : t('sheet.showDetails')}
          onClick={() => setInfoOpen(!infoOpen)}
        >
          <span className="details-title">{t('sheet.details')}</span>
          {!infoOpen && (
            <span className="details-summary">
              {[
                t(`sheetType.${sheet.type}`),
                `${t(`instrument.${sheet.instrument}`)} ${tuningLabel(sheet.tuning)}`,
                t('sheet.fretsN', { count: sheetFrets(sheet) }),
                `${sheet.tempo} BPM`,
                sheet.timeSignature.join('/'),
                sheet.key,
                ...sheet.tags.map((x) => `#${x}`),
              ].join(' · ')}
            </span>
          )}
          <span className="details-chevron"><Icon name="chevron" /></span>
        </button>
        {infoOpen && (
        <div id="sheet-details" className="stack">
        <div className="field-row">
          <label className="field">
            <span>{t('sheet.type')}</span>
            <select
              className="select"
              value={sheet.type}
              onChange={async (e) => {
                const result = await switchSheetType(sheet.id, e.target.value as SheetType)
                if (result !== 'same') toast(t(`sheet.switched.${result}`))
              }}
            >
              {SHEET_TYPES.map((x) => (
                <option key={x} value={x}>{t(`sheetType.${x}`)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('sheet.section')}</span>
            <select className="select" value={sheet.sectionId ?? ''} onChange={(e) => save({ sectionId: e.target.value || null })}>
              <option value="">{t('nav.unsorted')}</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>
        <TuningPicker value={{ instrument: sheet.instrument, tuning: sheet.tuning }} onChange={(v) => save(v)} />
        <div className="field-row">
          <label className="field">
            <span>{t('sheet.tempo')} (BPM)</span>
            <input className="input" type="number" min={20} max={300} defaultValue={sheet.tempo} key={`tempo-${sheet.id}`}
              onBlur={(e) => {
                const v = Math.min(300, Math.max(20, Number(e.target.value) || sheet.tempo))
                e.target.value = String(v)
                if (v !== sheet.tempo) save({ tempo: v })
              }} />
          </label>
          <label className="field">
            <span>{t('sheet.frets')}</span>
            <input className="input" type="number" min={MIN_FRETS} max={MAX_FRET} defaultValue={sheetFrets(sheet)} key={`frets-${sheet.id}-${sheet.frets}`}
              onBlur={(e) => {
                const v = Math.min(MAX_FRET, Math.max(MIN_FRETS, Math.round(Number(e.target.value)) || sheetFrets(sheet)))
                e.target.value = String(v)
                if (v !== sheetFrets(sheet)) save({ frets: v })
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          </label>
          <label className="field">
            <span>{t('sheet.timeSignature')}</span>
            <select className="select" value={sheet.timeSignature.join('/')} onChange={(e) => save({ timeSignature: e.target.value.split('/').map(Number) as [number, number] })}>
              {TIME_SIGNATURES.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('sheet.key')}</span>
            <select className="select" value={sheet.key} onChange={(e) => save({ key: e.target.value })}>
              {KEYS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>{t('sheet.tags')}</span>
          <input className="input" placeholder={t('sheet.tagsPlaceholder')} value={tagsDraft ?? sheet.tags.join(', ')}
            onChange={(e) => setTagsDraft(e.target.value)} onBlur={commitTags} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        </label>
        </div>
        )}
      </section>

      {sheet.type === 'tab' ? (
        <TabWorkspace key={`${sheet.id}:${sheet.type}`} sheet={sheet} />
      ) : sheet.type === 'chord' ? (
        <ChordChartWorkspace key={`${sheet.id}:${sheet.type}`} sheet={sheet} />
      ) : (
        <MelodyWorkspace key={`${sheet.id}:${sheet.type}`} sheet={sheet} />
      )}

      <AddToSongbookDialog open={toSongbook} onClose={() => setToSongbook(false)} sheetId={sheet.id} />
      <ConfirmModal
        open={deleting}
        danger
        title={t('sheet.deleteTitle')}
        body={t('sheet.deleteBody', { name: sheet.title })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          const back = sheet.sectionId ? `/section/${sheet.sectionId}` : '/unsorted'
          void deleteSheet(sheet.id).then(() => navigate(back, { replace: true }))
        }}
      />
    </div>
  )
}
