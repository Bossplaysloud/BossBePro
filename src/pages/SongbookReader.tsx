import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { db, type Sheet } from '../db/db'
import { ChartPreview } from '../components/ChordChartWorkspace'
import { Icon } from '../components/Icon'
import { ImageSheetRead } from '../components/ImageSheetView'
import { JianpuView } from '../components/Jianpu'
import { ScoreView } from '../components/ScoreView'
import { useTwoPage } from '../lib/settings'
import { melodyToAlphaTex, tabToAlphaTex, type MelodyTexOptions } from '../music/alphatex'
import { isChordChartContent } from '../music/chordChart'
import { sheetProgram } from '../music/instruments'
import { isMelodyContent, numberedBase } from '../music/melody'
import { isTabContent } from '../music/tab'

const CLEF: Record<Sheet['instrument'], MelodyTexOptions['clef']> = { guitar: 'treble8', custom: 'treble8', bass: 'bass', ukulele: 'treble' }
const SIZE_KEY = 'bepro.readerSize'
const noop = () => {}

function savedSize() {
  try {
    const v = Number(localStorage.getItem(SIZE_KEY))
    return v >= 0.7 && v <= 2.5 ? v : 1.15
  } catch {
    return 1.15
  }
}

/** The sheet itself, read-only and large: chord chart, numbered notation, or the score. */
export function SheetView({ sheet }: { sheet: Sheet }) {
  const { t } = useTranslation()
  const c = sheet.content
  const tex = useMemo(() => {
    if (sheet.type === 'tab' && isTabContent(c)) return tabToAlphaTex(c, { title: sheet.title, tempo: sheet.tempo, tuning: sheet.tuning, timeSignature: sheet.timeSignature, program: sheetProgram(sheet) })
    if (sheet.type === 'staff' && isMelodyContent(c)) return melodyToAlphaTex(c, { title: sheet.title, tempo: sheet.tempo, timeSignature: sheet.timeSignature, key: sheet.key, clef: CLEF[sheet.instrument], program: sheetProgram(sheet) })
    return null
  }, [sheet, c])

  if (sheet.type === 'image') return <ImageSheetRead content={c} />
  if (sheet.type === 'chord' && isChordChartContent(c)) {
    const capo = c.capo ?? 0
    return (
      <ChartPreview
        text={c.text}
        active={null}
        onChord={noop}
        large
        zoomable={false}
        header={
          <div className="chart-status">
            <span className="chip-static">{t('chart.writtenKey', { key: sheet.key })}</span>
            {capo > 0 && <span className="chip-static on">Capo {capo}</span>}
            {c.meta?.tempo && <span className="chip-static">♩={c.meta.tempo}</span>}
          </div>
        }
      />
    )
  }
  if (sheet.type === 'numbered' && isMelodyContent(c)) {
    return (
      <JianpuView
        content={c}
        base={numberedBase(sheet.tuning, sheet.key)}
        keyName={sheet.key}
        timeSignature={sheet.timeSignature}
        tempo={sheet.tempo}
        title={sheet.title}
        range={[0, 0]}
        playing={null}
        onMeasureClick={noop}
        zoomable={false}
      />
    )
  }
  if (tex) return <ScoreView tex={tex} visible profile={sheet.type === 'staff' ? 'score' : 'tab'} range={[0, 0]} onMeasureClick={noop} onApi={noop} onBeat={noop} onStatus={noop} />
  return <div className="empty"><h2>{t('sheet.notFound')}</h2></div>
}

/**
 * Songbook reading mode: one song at a time, full screen and read-only, for playing from.
 * ← / → change song; Page Down / Space / ↓ scroll down and then go to the next song (page-turner
 * pedals send these), Page Up / ↑ scroll back; swiping sideways changes song on a touch screen.
 */
export function SongbookReader() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id, pos } = useParams()
  const book = useLiveQuery(async () => (await db.songbooks.get(id!)) ?? null, [id])
  const sheets = useLiveQuery(() => db.sheets.toArray(), [])
  const [size, setSize] = useState(savedSize)
  const [twoPage, setTwoPage] = useTwoPage()
  const bodyRef = useRef<HTMLDivElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)

  const entries = useMemo(() => {
    const byId = new Map((sheets ?? []).map((s) => [s.id, s]))
    return (book?.entries ?? []).flatMap((e) => (byId.has(e.sheetId) ? [{ entry: e, sheet: byId.get(e.sheetId)! }] : []))
  }, [book, sheets])
  const index = Math.max(0, Math.min(entries.length - 1, Number(pos ?? 1) - 1))
  const current = entries[index]

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= entries.length) return
      navigate(`/songbook/${id}/play/${to + 1}`, { replace: true })
    },
    [entries.length, id, navigate],
  )

  // A new song starts at the top.
  useEffect(() => {
    // (newer browsers return a promise from scrollTo: it must not become the effect's cleanup)
    void bodyRef.current?.scrollTo({ top: 0 })
  }, [index])

  // Keep the screen on while reading (where the browser allows it).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }
    nav.wakeLock?.request('screen').then((l) => (lock = l), noop)
    return () => void lock?.release().catch(noop)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const el = bodyRef.current
      if (!el) return
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      const atTop = el.scrollTop <= 4
      if (e.key === 'ArrowRight') go(index + 1)
      else if (e.key === 'ArrowLeft') go(index - 1)
      else if (e.key === 'PageDown' || e.key === ' ' || e.key === 'ArrowDown') {
        if (atBottom) go(index + 1)
        else void el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' })
      } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
        if (atTop) go(index - 1)
        else void el.scrollBy({ top: -el.clientHeight * 0.85, behavior: 'smooth' })
      } else if (e.key === 'Escape') navigate(`/songbook/${id}`)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index, id, navigate])

  const resize = (d: number) => {
    const next = Math.round(Math.max(0.7, Math.min(2.5, size + d)) * 100) / 100
    setSize(next)
    try {
      localStorage.setItem(SIZE_KEY, String(next))
    } catch {
      /* not stored */
    }
  }

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(noop)
    else void document.documentElement.requestFullscreen?.().catch(noop)
  }

  if (book === null) return <Navigate to="/" replace />
  if (book === undefined || sheets === undefined) return null
  if (!current)
    return (
      <div className="reader">
        <div className="empty">
          <h2>{t('songbook.empty')}</h2>
          <Link className="btn" to={`/songbook/${id}`}>{t('common.back')}</Link>
        </div>
      </div>
    )

  const prev = entries[index - 1]
  const next = entries[index + 1]
  const sheet = current.sheet
  const sizable = sheet.type === 'chord' || sheet.type === 'numbered' || sheet.type === 'image'

  return (
    <div className="reader">
      <header className="reader-bar">
        <Link className="btn btn-ghost btn-icon" to={`/songbook/${id}`} title={t('reader.exit')} aria-label={t('reader.exit')}>
          <Icon name="close" />
        </Link>
        <div className="reader-title">
          <span className="reader-pos">{index + 1} / {entries.length}</span>
          <strong>{sheet.title}</strong>
          <span className="muted small">{book.name}</span>
        </div>
        {sizable && (
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-icon" onClick={() => resize(-0.15)} title={t('reader.smaller')} aria-label={t('reader.smaller')}>A−</button>
            <button className="btn btn-icon" onClick={() => resize(0.15)} title={t('reader.larger')} aria-label={t('reader.larger')}>A+</button>
          </div>
        )}
        <button className="btn" aria-pressed={twoPage} onClick={() => setTwoPage(!twoPage)} title={t('view.twoPageHint')}>{t('view.twoPage')}</button>
        <button className="btn btn-ghost btn-icon" onClick={fullscreen} title={t('reader.fullscreen')} aria-label={t('reader.fullscreen')}>
          <Icon name="expand" />
        </button>
        <Link className="btn btn-ghost btn-icon" to={`/sheet/${sheet.id}`} title={t('reader.edit')} aria-label={t('reader.edit')}>
          <Icon name="edit" />
        </Link>
      </header>

      <div
        ref={bodyRef}
        className="reader-body"

        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const s = touch.current
          touch.current = null
          if (!s) return
          const dx = e.changedTouches[0].clientX - s.x
          const dy = e.changedTouches[0].clientY - s.y
          // A clear sideways swipe changes song; vertical moves just scroll.
          if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) go(dx < 0 ? index + 1 : index - 1)
        }}
      >
        {/* Chord charts and numbered notation scale as a whole; scores lay themselves out to the width. */}
        <div className={`reader-sheet${twoPage ? ' wide' : ''}`} style={sizable ? { zoom: size } : undefined}>
          <SheetView key={current.entry.id} sheet={sheet} />
        </div>
      </div>

      <footer className="reader-nav">
        <button className="btn reader-step" disabled={!prev} onClick={() => go(index - 1)}>
          <Icon name="prev" />
          <span className="reader-step-text">
            <span className="small muted">{t('reader.previous')}</span>
            <span className="reader-step-title">{prev?.sheet.title ?? '—'}</span>
          </span>
        </button>
        <button className="btn reader-step next" disabled={!next} onClick={() => go(index + 1)}>
          <span className="reader-step-text">
            <span className="small muted">{t('reader.next')}</span>
            <span className="reader-step-title">{next?.sheet.title ?? '—'}</span>
          </span>
          <Icon name="next" />
        </button>
      </footer>
    </div>
  )
}
