import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import type { model } from '@coderline/alphatab'
import { Icon } from '../components/Icon'
import { ScoreView } from '../components/ScoreView'
import { useToast } from '../components/Toast'
import { TuningPicker, type TuningValue } from '../components/TuningPicker'
import { db } from '../db/db'
import { createSheet, updateSheet } from '../db/repo'
import { pickScoreFile } from '../lib/pickFiles'
import { melodyToAlphaTex, tabToAlphaTex } from '../music/alphatex'
import { convertTrack, GP_EXTENSIONS, listTracks, trackTitle, type GpSheet, type GpTrackInfo } from '../music/gpImport'
import { DEFAULT_FRETS, tuningLabel } from '../music/instruments'
import { isMelodyContent } from '../music/melody'
import { isTabContent } from '../music/tab'

type Stage = 'pick' | 'loading' | 'tracks' | 'review'

/** What the library hands over: the picked file and the section it was opened from. */
export interface ImportGpState {
  file?: File
  sectionId?: string | null
}

async function readScore(file: File): Promise<model.Score> {
  const at = await import('@coderline/alphatab')
  return at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await file.arrayBuffer()), new at.Settings())
}

/** Imports Guitar Pro / MusicXML files as ordinary editable sheets (no AI): pick tracks, review, create. */
export function ImportGpPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const state = (useLocation().state ?? {}) as ImportGpState
  const [stage, setStage] = useState<Stage>(state.file ? 'loading' : 'pick')
  const [error, setError] = useState('')
  const [file, setFile] = useState<{ name: string; score: model.Score } | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())

  const open = (f: File) => {
    setError('')
    setStage('loading')
    readScore(f)
      .then((score) => {
        const importable = listTracks(score).filter((x) => x.kind === 'tab' || x.kind === 'staff')
        if (!importable.length) throw new Error('no tracks')
        setFile({ name: f.name, score })
        setPicked(new Set([importable[0].index]))
        setStage(importable.length === 1 ? 'review' : 'tracks')
      })
      .catch((e: unknown) => {
        setError(e instanceof Error && e.message === 'no tracks' ? t('gp.noTracks') : t('gp.cannotRead'))
        setStage('pick')
      })
  }

  useEffect(() => {
    if (state.file) open(state.file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tracks = useMemo(() => (file ? listTracks(file.score) : []), [file])
  const sheets = useMemo(
    () => (stage === 'review' && file ? [...picked].sort((a, b) => a - b).map((i) => convertTrack(file.score, i, trackTitle(file.score, i, file.name))) : []),
    [stage, file, picked],
  )
  const choose = () => pickScoreFile(GP_EXTENSIONS, open)

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label={t('common.back')}><Icon name="back" /></button>
        <h1>{t('gp.title')}</h1>
        {file && <span className="muted small">{file.name}</span>}
      </div>

      {error && <div className="ai-error" role="alert">{error}</div>}

      {stage === 'pick' && (
        <div className="panel stack">
          <div className="pick-buttons">
            <button className="btn btn-primary" onClick={choose}><Icon name="upload" />{t('gp.chooseFile')}</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>{t('gp.formats')}</p>
        </div>
      )}

      {stage === 'loading' && (
        <div className="panel stack ai-running">
          <div className="spinner" aria-hidden="true" />
          <strong>{t('gp.loading')}</strong>
        </div>
      )}

      {stage === 'tracks' && (
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>{t('gp.tracks')}</h2>
          <p className="muted small" style={{ margin: 0 }}>{t('gp.tracksHint')}</p>
          {tracks.map((x) => (
            <TrackRow
              key={x.index}
              track={x}
              checked={picked.has(x.index)}
              onToggle={(on) =>
                setPicked((old) => {
                  const next = new Set(old)
                  if (on) next.add(x.index)
                  else next.delete(x.index)
                  return next
                })
              }
            />
          ))}
          <div className="row">
            <button className="btn" onClick={choose}>{t('gp.another')}</button>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={!picked.size} onClick={() => setStage('review')}>{t('gp.next')}</button>
          </div>
        </div>
      )}

      {stage === 'review' && sheets.length > 0 && (
        <Review
          sheets={sheets}
          initialSection={state.sectionId ?? null}
          onBack={() => (tracks.filter((x) => x.kind === 'tab' || x.kind === 'staff').length > 1 ? setStage('tracks') : choose())}
          onCreate={async (sheets, sectionId) => {
            const ids: string[] = []
            for (const s of sheets) {
              const id = await createSheet({ title: s.title, type: s.type, sectionId, instrument: s.instrument, strings: s.tuning.length, tuning: s.tuning })
              await updateSheet(id, { content: s.content, key: s.key, timeSignature: s.timeSignature, tempo: s.tempo, frets: s.frets })
              ids.push(id)
            }
            toast(ids.length > 1 ? t('gp.createdN', { count: ids.length }) : t('gp.created'))
            navigate(`/sheet/${ids[0]}`, { replace: true })
          }}
        />
      )}
    </div>
  )
}

function TrackRow({ track, checked, onToggle }: { track: GpTrackInfo; checked: boolean; onToggle: (on: boolean) => void }) {
  const { t } = useTranslation()
  const disabled = track.kind === 'drums' || track.kind === 'empty'
  const what =
    track.kind === 'tab'
      ? `${t('gp.toTab')} · ${t(`instrument.${track.instrument}`)} · ${t('gp.strings', { count: track.tuning.length })} · ${tuningLabel(track.tuning)}`
      : track.kind === 'staff'
        ? t('gp.toStaff')
        : t(`gp.${track.kind}`)
  return (
    <label className="choice" style={disabled ? { opacity: 0.55 } : undefined}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
      <span style={{ flex: 1 }}>
        <strong>{track.name || t('gp.trackN', { n: track.index + 1 })}</strong>
        <br />
        <span className="muted small">{what}</span>
      </span>
    </label>
  )
}

/** Confirmation before creating: title and instrument per sheet, one section for all, skipped items listed. */
function Review({ sheets, initialSection, onBack, onCreate }: {
  sheets: GpSheet[]
  initialSection: string | null
  onBack: () => void
  onCreate: (sheets: GpSheet[], sectionId: string | null) => Promise<void>
}) {
  const { t } = useTranslation()
  const sections = useLiveQuery(() => db.sections.orderBy('order').toArray(), []) ?? []
  const [section, setSection] = useState<string | null>(initialSection)
  const [titles, setTitles] = useState<string[]>(() => sheets.map((s) => s.title))
  const [tunings, setTunings] = useState<(TuningValue | null)[]>(() => sheets.map(() => null))
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)

  const final: GpSheet[] = sheets.map((s, i) => {
    const tv = tunings[i]
    const frets = s.frets > DEFAULT_FRETS[s.instrument] ? s.frets : DEFAULT_FRETS[tv?.instrument ?? s.instrument]
    return { ...s, title: titles[i].trim() || s.title, ...(tv ? { instrument: tv.instrument, tuning: tv.tuning, frets } : {}) }
  })
  const sheet = final[active]
  const tex = isTabContent(sheet.content)
    ? tabToAlphaTex(sheet.content, { title: sheet.title, tempo: sheet.tempo, tuning: sheet.tuning, timeSignature: sheet.timeSignature })
    : isMelodyContent(sheet.content)
      ? melodyToAlphaTex(sheet.content, { title: sheet.title, tempo: sheet.tempo, timeSignature: sheet.timeSignature, key: sheet.key, clef: sheet.instrument === 'bass' ? 'bass' : sheet.instrument === 'ukulele' ? 'treble' : 'treble8' })
      : ''
  const noop = () => {}

  return (
    <section className="stack">
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>{t('gp.result')}</h2>
        {final.length > 1 && (
          <div className="segmented" role="group" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
            {final.map((s, i) => (
              <button key={i} aria-pressed={i === active} onClick={() => setActive(i)}>{s.title}</button>
            ))}
          </div>
        )}
        <p className="small" style={{ margin: 0 }}>
          {t(`sheetType.${sheet.type}`)} · {t('gp.measures', { count: sheet.content.measures.length })} · {sheet.key} · {sheet.timeSignature.join('/')} · ♩={sheet.tempo}
        </p>
        {sheet.warnings.length > 0 && (
          <>
            <p className="small" style={{ margin: 0 }}>{t('gp.skipped')}</p>
            <ul className="ai-warnings">
              {sheet.warnings.map((w) => <li key={w.code}>{t(`gp.warn.${w.code}`, { count: w.count, detail: w.detail ?? '' })}</li>)}
            </ul>
          </>
        )}
        <label className="field">
          <span>{t('sheet.title')}</span>
          <input className="input" value={titles[active]} placeholder={sheets[active].title} onChange={(e) => setTitles(titles.map((x, i) => (i === active ? e.target.value : x)))} />
        </label>
        <TuningPicker
          key={active}
          value={tunings[active] ?? { instrument: sheet.instrument, tuning: sheet.tuning }}
          onChange={(v) => setTunings(tunings.map((x, i) => (i === active ? v : x)))}
        />
        <label className="field">
          <span>{t('sheet.section')}</span>
          <select className="select" value={section ?? ''} onChange={(e) => setSection(e.target.value || null)}>
            <option value="">{t('nav.unsorted')}</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="row">
          <button className="btn" onClick={onBack} disabled={busy}>{t('common.back')}</button>
          <span className="spacer" />
          <button className="btn btn-primary" disabled={busy} onClick={() => (setBusy(true), void onCreate(final, section).finally(() => setBusy(false)))}>
            {final.length > 1 ? t('gp.createN', { count: final.length }) : t('gp.create')}
          </button>
        </div>
      </div>
      {tex && <ScoreView key={tex} tex={tex} visible profile={sheet.type === 'tab' ? 'tab' : 'score'} range={[0, 0]} onMeasureClick={noop} onApi={noop} onBeat={noop} onStatus={noop} />}
    </section>
  )
}
