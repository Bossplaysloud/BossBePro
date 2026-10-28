import { useTranslation } from 'react-i18next'
import { chordDegree, keyTonic, parseChord, scaleDegree, type Chord } from '../music/chords'
import { noteName } from '../music/instruments'
import type { FretUse } from '../music/tab'
import type { Position } from '../music/melody'
import { useChordTones, useFretLabels, useFretPanelOpen, useFretPanelPinned, useRangeSize, type CustomRange } from '../lib/settings'
import { Fretboard, type FretMark } from './Fretboard'
import { Icon } from './Icon'

const SIZES = [1, 2, 4, 8, 0, -1] // -1 = custom

interface Props {
  /** Number of measures, for range navigation. */
  total: number
  /** Measures [from, to) currently shown. */
  range: [number, number]
  /** Positions played in the range. */
  uses: FretUse[]
  /** Other places the same pitches could be played (melodies), drawn as outlines. */
  alternatives?: Position[]
  /** Chord used for "chord tones" when no cursor chord applies (e.g. the chord at the start of the range). */
  rangeChord?: string
  tuning: number[]
  frets: number
  keyName: string // sheet key, e.g. "G" or "Em": degrees use it when no chord is set
  setFocus: (m: number) => void
  /** Positions of the beat under the cursor / being played, drawn highlighted. */
  current?: Position[]
  /** Chord in effect at the cursor (edit mode). */
  currentChord?: string
  onCellClick?: (string: number, fret: number) => void
  /** The sheet's custom range, and setting it (range size -1). */
  custom?: CustomRange | null
  onCustom?: (r: CustomRange) => void
  /** Where the editing cursor is, for "start / end at the cursor". */
  cursor?: { m: number; b: number } | null
}

const chordCache = new Map<string, Chord | null>()
const chordOf = (name?: string) => {
  if (!name) return null
  if (!chordCache.has(name)) chordCache.set(name, parseChord(name))
  return chordCache.get(name)!
}

export function FretPanel({ total, range, uses, alternatives = [], rangeChord, tuning, frets, keyName, setFocus, current = [], currentChord, onCellClick, custom, onCustom, cursor }: Props) {
  const { t } = useTranslation()
  const [size, setSize] = useRangeSize()
  const [labels, setLabels] = useFretLabels()
  const [showTones, setShowTones] = useChordTones()
  const [open, setOpen] = useFretPanelOpen()
  const [pinned, setPinned] = useFretPanelPinned()
  const [from, to] = range
  const tonic = keyTonic(keyName)

  const describe = (string: number, fret: number, chordName?: string): Pick<FretMark, 'label' | 'root'> => {
    const midi = tuning[string - 1] + fret
    const chord = chordOf(chordName)
    if (labels === 'note') return { label: noteName(midi), root: chord ? midi % 12 === chord.root : undefined }
    if (chord) return { label: chordDegree(midi, chord), root: midi % 12 === chord.root }
    return { label: scaleDegree(midi, tonic), root: (midi - tonic) % 12 === 0 }
  }

  const marks: FretMark[] = uses.map((u) => ({ ...u, ...describe(u.string, u.fret, u.chord) }))
  for (const p of alternatives) {
    if (marks.some((x) => x.string === p.string && x.fret === p.fret)) continue
    marks.push({ ...p, alt: true, ...describe(p.string, p.fret, rangeChord) })
  }
  for (const n of current) {
    if (n.string > tuning.length) continue
    const alt = marks.findIndex((x) => x.alt && x.string === n.string && x.fret === n.fret)
    if (alt >= 0) marks.splice(alt, 1)
    const existing = marks.find((x) => x.string === n.string && x.fret === n.fret)
    if (existing) Object.assign(existing, { current: true, ...describe(n.string, n.fret, currentChord) })
    else marks.push({ string: n.string, fret: n.fret, current: true, ...describe(n.string, n.fret, currentChord) })
  }

  // Chord shown for reference: the cursor's chord while editing, otherwise the one at the start of the range.
  const activeChordName = currentChord ?? rangeChord
  const activeChord = chordOf(activeChordName)
  if (showTones && activeChord) {
    tuning.forEach((open, i) => {
      for (let f = 0; f <= frets; f++) {
        const pc = (open + f) % 12
        if (!activeChord.degrees.has((pc - activeChord.root + 12) % 12)) continue
        if (marks.some((m) => m.string === i + 1 && m.fret === f)) continue
        marks.push({ string: i + 1, fret: f, faint: true, ...describe(i + 1, f, activeChordName) })
      }
    })
  }

  const label = to - from <= 1 ? t('fretboard.windowOne', { from: from + 1 }) : t('fretboard.window', { from: from + 1, to })
  // Custom range: shown 1-based; an empty beat box means the whole measure.
  const range0: CustomRange = custom ?? { from: { m: from, b: null }, to: { m: Math.max(from, to - 1), b: null } }
  const setEnd = (end: 'from' | 'to', patch: Partial<CustomRange['from']>) => onCustom?.({ ...range0, [end]: { ...range0[end], ...patch } })
  const numberBox = (value: number | null, onChange: (v: number | null) => void, label: string, optional = false) => (
    <input
      className="input range-num"
      type="number"
      min={1}
      inputMode="numeric"
      aria-label={label}
      title={label}
      placeholder={optional ? t('fretboard.wholeMeasure') : undefined}
      value={value === null ? '' : value + 1}
      onChange={(e) => {
        const v = e.target.value.trim()
        if (!v) return optional ? onChange(null) : undefined
        const n = Math.round(Number(v))
        if (Number.isFinite(n) && n >= 1) onChange(n - 1)
      }}
    />
  )
  const legend =
    labels === 'degree'
      ? activeChord
        ? t('fretboard.degreeChord', { chord: activeChordName })
        : t('fretboard.degreeKey', { tonic: noteName(tonic) })
      : null

  return (
    <section className={`fret-panel${pinned ? ' pinned' : ''}`} aria-label={t('fretboard.title')}>
      <div className="fret-panel-head">
        <strong>{t('fretboard.title')}</strong>
        {open && (
          <>
            <select
              className="select"
              value={size}
              onChange={(e) => {
                const n = Number(e.target.value)
                setSize(n)
                // Starting a custom range: begin with the measures shown now.
                if (n < 0 && !custom) onCustom?.(range0)
              }}
              aria-label={t('fretboard.range')}
            >
              {SIZES.filter((n) => n >= 0 || onCustom).map((n) => (
                <option key={n} value={n}>{n === 0 ? t('fretboard.rangeAll') : n < 0 ? t('fretboard.rangeCustom') : t('fretboard.rangeN', { count: n })}</option>
              ))}
            </select>
            {size < 0 && onCustom && (
              <span className="range-custom">
                {t('fretboard.fromMeasure')}
                {numberBox(range0.from.m, (m) => m !== null && setEnd('from', { m: Math.min(total - 1, m) }), t('fretboard.fromMeasureLabel'))}
                {t('fretboard.noteNo')}
                {numberBox(range0.from.b, (b) => setEnd('from', { b }), t('fretboard.fromNoteLabel'), true)}
                {t('fretboard.noteSuffix')}
                <span aria-hidden="true">～</span>
                {t('fretboard.fromMeasure')}
                {numberBox(range0.to.m, (m) => m !== null && setEnd('to', { m: Math.min(total - 1, m) }), t('fretboard.toMeasureLabel'))}
                {t('fretboard.noteNo')}
                {numberBox(range0.to.b, (b) => setEnd('to', { b }), t('fretboard.toNoteLabel'), true)}
                {t('fretboard.noteSuffix')}
                {cursor && (
                  <>
                    <button className="btn" onClick={() => setEnd('from', { m: cursor.m, b: cursor.b })} title={t('fretboard.startAtCursorHint')}>{t('fretboard.startAtCursor')}</button>
                    <button className="btn" onClick={() => setEnd('to', { m: cursor.m, b: cursor.b })} title={t('fretboard.endAtCursorHint')}>{t('fretboard.endAtCursor')}</button>
                  </>
                )}
              </span>
            )}
            {size > 0 && (
              <>
                <button className="btn btn-ghost btn-icon" disabled={from === 0} onClick={() => setFocus(Math.max(0, from - size))} aria-label={t('fretboard.prev')} title={t('fretboard.prev')}>
                  <Icon name="prev" />
                </button>
                <span className="small">{label}</span>
                <button className="btn btn-ghost btn-icon" disabled={to >= total} onClick={() => setFocus(Math.min(total - 1, from + size))} aria-label={t('fretboard.next')} title={t('fretboard.next')}>
                  <Icon name="next" />
                </button>
              </>
            )}
            <div className="segmented" role="group" aria-label={t('fretboard.labels')}>
              <button aria-pressed={labels === 'degree'} onClick={() => setLabels('degree')}>{t('fretboard.degree')}</button>
              <button aria-pressed={labels === 'note'} onClick={() => setLabels('note')}>{t('fretboard.note')}</button>
            </div>
            <button className="btn" aria-pressed={showTones} disabled={!activeChord} onClick={() => setShowTones(!showTones)} title={t('fretboard.chordTonesHint')}>
              {t('fretboard.chordTones')}
            </button>
          </>
        )}
        <span className="spacer" />
        <label className="pin-toggle" title={t('fretboard.pinHint')}>
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          {t('fretboard.pin')}
        </label>
        <button className="btn btn-ghost btn-icon" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? t('fretboard.hide') : t('fretboard.show')} title={open ? t('fretboard.hide') : t('fretboard.show')}>
          <span style={{ display: 'flex', transform: open ? 'none' : 'rotate(180deg)' }}><Icon name="chevron" /></span>
        </button>
      </div>
      {open && <Fretboard tuning={tuning} frets={frets} marks={marks} onCellClick={onCellClick} />}
      {open && (
        <div className="row fb-legend">
          {legend && <span>{legend}</span>}
          {onCellClick && <span>{t('fretboard.tapHint')}</span>}
        </div>
      )}
    </section>
  )
}
