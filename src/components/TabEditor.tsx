import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { noteName } from '../music/instruments'
import {
  DURATIONS,
  TIME_SIGNATURES,
  applyShape,
  clearBeat,
  cycleBend,
  cycleSlide,
  cycleTuplet,
  deleteBeat,
  deleteMeasure,
  getNote,
  insertBeatAfter,
  insertMeasureAfter,
  measureFill,
  setChord,
  setDuration,
  setMeasureTs,
  setNote,
  stepBeat,
  toggleDot,
  toggleFlag,
  toggleHarmonic,
  toggleLegato,
  toggleTie,
  tsAt,
  type Cursor,
  type Duration,
  type TabContent,
  type TabNote,
} from '../music/tab'
import { useKeypad } from '../lib/settings'
import { melodyToTab } from '../music/convert'
import { tabToText } from '../music/textTab'
import { SelectionBar, useBeatSelection } from './BeatSelection'
import { ChordDialog } from './ChordDialog'
import { FitDialog } from './FitDialog'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { TextTabDialog } from './TextTabDialog'
import { TidyDialog } from './TidyDialog'
import { useToast } from './Toast'

interface Props {
  content: TabContent
  onChange: (fn: (c: TabContent) => TabContent) => void
  cursor: Cursor
  setCursor: (c: Cursor) => void
  /** Beat currently sounding during playback. */
  playing?: { m: number; b: number } | null
  tuning: number[]
  frets: number
  /** The sheet's time signature (measures can change it from some point on). */
  timeSignature: [number, number]
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export const DURATION_LABEL: Record<Duration, string> = { 1: '1', 2: '1/2', 4: '1/4', 8: '1/8', 16: '1/16', 32: '1/32' }
const SUPERSCRIPT: Record<number, string> = { 3: '³', 5: '⁵', 6: '⁶' }
const BEND_LABEL: Record<number, string> = { 0.5: '½', 1: '1', 1.5: '1½', 2: '2' }

const TWO_DIGIT_MS = 800

type Technique =
  | 'hammer' | 'pull' | 'slide' | 'slideIn' | 'slideOut' | 'bend' | 'release' | 'natural' | 'artificial'
  | 'palmMute' | 'dead' | 'vibrato' | 'letRing' | 'ghost' | 'tap' | 'tie' | 'tuplet'

/** Keyboard letter for each technique (also shown on the buttons and in the help dialog). */
export const TECHNIQUE_KEYS: Record<Technique, string> = {
  hammer: 'H', pull: 'P', slide: '/', slideIn: 'I', slideOut: 'O', bend: 'B', release: 'R', natural: 'N', artificial: 'A',
  palmMute: 'M', dead: 'X', vibrato: 'V', letRing: 'L', ghost: 'G', tap: 'K', tie: 'T', tuplet: 'U',
}
const KEY_TO_TECHNIQUE = new Map(Object.entries(TECHNIQUE_KEYS).map(([k, v]) => [v.toLowerCase(), k as Technique]))
const TECHNIQUES = Object.keys(TECHNIQUE_KEYS) as Technique[]

function isOn(t: Technique, n: TabNote | undefined, tuplet: number | undefined): boolean {
  switch (t) {
    case 'hammer': return n?.legato === 'h'
    case 'pull': return n?.legato === 'p'
    case 'slide': return n?.slide === 'to'
    case 'slideIn': return n?.slide === 'inBelow' || n?.slide === 'inAbove'
    case 'slideOut': return n?.slide === 'outDown' || n?.slide === 'outUp'
    case 'bend': return !!n?.bend
    case 'release': return !!n?.release
    case 'natural': return n?.harmonic === 'natural'
    case 'artificial': return n?.harmonic === 'artificial'
    case 'palmMute': return !!n?.palmMute
    case 'dead': return !!n?.dead
    case 'vibrato': return !!n?.vibrato
    case 'letRing': return !!n?.letRing
    case 'ghost': return !!n?.ghost
    case 'tap': return !!n?.tap
    case 'tie': return !!n?.tie
    case 'tuplet': return !!tuplet
  }
}

/** Text shown in a TAB cell: prefix, fret and a compact technique suffix. */
function cellParts(n: TabNote): { pre: string; main: string; post: string } {
  if (n.dead) return { pre: '', main: 'x', post: n.palmMute ? 'pm' : '' }
  const main = n.harmonic === 'natural' ? `<${n.fret}>` : n.harmonic === 'artificial' ? `[${n.fret}]` : n.ghost ? `(${n.fret})` : String(n.fret)
  const pre = (n.tap ? 'T' : '') + (n.slide === 'inBelow' ? '↗' : n.slide === 'inAbove' ? '↘' : '')
  let post = ''
  if (n.bend) post += `b${BEND_LABEL[n.bend] ?? n.bend}${n.release ? 'r' : ''}`
  if (n.vibrato) post += '~'
  if (n.legato) post += n.legato
  if (n.slide === 'to') post += '/'
  if (n.slide === 'outDown') post += '↘'
  if (n.slide === 'outUp') post += '↗'
  if (n.palmMute) post += ' pm'
  if (n.letRing) post += ' lr'
  return { pre, main, post: post.trim() }
}

export function TabEditor({ content, onChange, cursor, setCursor, playing, tuning, frets, timeSignature, undo, redo, canUndo, canRedo }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const strings = tuning.length
  const [keypad, setKeypad] = useKeypad()
  const [help, setHelp] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  const [chordBeat, setChordBeat] = useState<{ m: number; b: number } | null>(null)
  const [fitMeasure, setFitMeasure] = useState<number | null>(null)
  const [tidyOpen, setTidyOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastDigit = useRef<{ at: number; key: string; value: number } | null>(null)
  const sawHardwareKey = useRef(false)
  const beat = content.measures[cursor.m]?.beats[cursor.b]
  const note = getNote(content, cursor)
  const sel = useBeatSelection({
    content,
    onChange,
    cursor,
    setCursor,
    timeSignature,
    kind: 'tab',
    adapt: (clip) => {
      const tab = melodyToTab({ kind: 'melody', version: 1, measures: (clip.measures ?? [{ id: 'clip', beats: clip.beats }]) as never }, tuning, frets)
      return clip.measures ? { beats: tab.measures.flatMap((m) => m.beats), measures: tab.measures } : { beats: tab.measures[0].beats }
    },
    toText: (beats) => tabToText({ kind: 'tab', version: 1, measures: [{ id: 'clip', beats }] }, tuning),
  })

  useEffect(() => {
    rootRef.current?.querySelector('.tab-cell.cursor')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [cursor])

  useEffect(() => {
    if (playing) rootRef.current?.querySelector('.tab-col.playing')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [playing])

  const cursorKey = `${cursor.m}:${cursor.b}:${cursor.s}`

  const enterDigit = (d: number) => {
    const now = Date.now()
    const last = lastDigit.current
    let value = d
    // A second digit typed quickly on the same cell makes a two-digit fret (e.g. 1 then 2 → 12).
    if (last && last.key === cursorKey && now - last.at < TWO_DIGIT_MS && last.value > 0 && last.value * 10 + d <= frets) {
      value = last.value * 10 + d
      lastDigit.current = null
    } else {
      lastDigit.current = { at: now, key: cursorKey, value: d }
    }
    onChange((c) => setNote(c, cursor, value, frets))
  }

  const enterFret = (f: number | 'x' | null) => {
    lastDigit.current = null
    onChange((c) => setNote(c, cursor, f, frets))
  }

  const applyTechnique = (tech: Technique) => {
    if (tech === 'dead') return enterFret(note?.dead ? null : 'x')
    if (tech === 'tie') {
      const next = toggleTie(content, cursor)
      if (next === content) return toast(t('tech.noTieSource'))
      return onChange(() => next)
    }
    if (tech === 'tuplet') return onChange((c) => cycleTuplet(c, cursor.m, cursor.b))
    if (!note || note.dead || note.tie) return toast(t('tech.needNote'))
    onChange((c) => {
      switch (tech) {
        case 'hammer': return toggleLegato(c, cursor, 'h')
        case 'pull': return toggleLegato(c, cursor, 'p')
        case 'slide': return cycleSlide(c, cursor, 'to')
        case 'slideIn': return cycleSlide(c, cursor, 'in')
        case 'slideOut': return cycleSlide(c, cursor, 'out')
        case 'bend': return cycleBend(c, cursor)
        case 'release': return note.bend ? toggleFlag(c, cursor, 'release') : c
        case 'natural': return toggleHarmonic(c, cursor, 'natural')
        case 'artificial': return toggleHarmonic(c, cursor, 'artificial')
        case 'palmMute': return toggleFlag(c, cursor, 'palmMute')
        case 'vibrato': return toggleFlag(c, cursor, 'vibrato')
        case 'letRing': return toggleFlag(c, cursor, 'letRing')
        case 'ghost': return toggleFlag(c, cursor, 'ghost')
        case 'tap': return toggleFlag(c, cursor, 'tap')
      }
    })
  }

  const move = (dir: 1 | -1) => {
    const next = stepBeat(content, cursor, dir)
    if (next) return setCursor(next)
    if (dir === 1) {
      // Moving right past the last beat starts a new measure.
      const last = content.measures.length - 1
      onChange((c) => insertMeasureAfter(c, last, tsAt(c, last, timeSignature)))
      setCursor({ ...cursor, m: last + 1, b: 0 })
    }
  }

  const addBeat = () => {
    onChange((c) => insertBeatAfter(c, cursor.m, cursor.b))
    setCursor({ ...cursor, b: cursor.b + 1 })
  }

  const removeBeat = () => {
    onChange((c) => deleteBeat(c, cursor.m, cursor.b))
    setCursor({ ...cursor, b: Math.max(0, Math.min(cursor.b, content.measures[cursor.m].beats.length - 2)) })
  }

  const addMeasure = () => {
    onChange((c) => insertMeasureAfter(c, cursor.m, tsAt(c, cursor.m, timeSignature)))
    setCursor({ ...cursor, m: cursor.m + 1, b: 0 })
  }

  const removeMeasure = () => {
    onChange((c) => deleteMeasure(c, cursor.m, timeSignature))
    setCursor({ ...cursor, m: Math.max(0, Math.min(cursor.m, content.measures.length - 2)), b: 0 })
  }

  const changeDuration = (dir: 1 | -1) => {
    if (!beat) return
    const i = DURATIONS.indexOf(beat.duration) + dir
    if (i >= 0 && i < DURATIONS.length) onChange((c) => setDuration(c, cursor.m, cursor.b, DURATIONS[i]))
  }

  /** A physical key press on a touch device means a hardware keyboard: hide the on-screen keypad once. */
  const noticeHardwareKeyboard = () => {
    if (sawHardwareKey.current) return
    sawHardwareKey.current = true
    if (keypad && matchMedia('(pointer: coarse)').matches) {
      setKeypad(false)
      toast(t('tab.keyboardDetected'))
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      redo()
      return
    }
    if (sel.onKey(e)) {
      e.preventDefault()
      return
    }
    if (mod || e.altKey) return
    const key = e.key
    const handled = (() => {
      if (/^[0-9]$/.test(key)) return enterDigit(Number(key)), true
      const tech = KEY_TO_TECHNIQUE.get(key.toLowerCase())
      if (tech) return applyTechnique(tech), true
      switch (key) {
        case 'Backspace':
        case 'Delete':
          return enterFret(null), true
        case 'ArrowUp':
          return setCursor({ ...cursor, s: Math.max(1, cursor.s - 1) }), true
        case 'ArrowDown':
          return setCursor({ ...cursor, s: Math.min(strings, cursor.s + 1) }), true
        case 'ArrowLeft':
          return move(-1), true
        case 'ArrowRight':
        case ' ':
          return move(1), true
        case 'Enter':
          return addBeat(), true
        case '.':
          return onChange((c) => toggleDot(c, cursor.m, cursor.b)), true
        case '-':
          return changeDuration(1), true // shorter
        case '+':
        case '=':
          return changeDuration(-1), true // longer
        case '?':
          return setHelp(true), true
        case 'c':
        case 'C':
          return setChordBeat({ m: cursor.m, b: cursor.b }), true
        case 'f':
        case 'F':
          return setFitMeasure(cursor.m), true
      }
      return false
    })()
    if (handled) {
      e.preventDefault()
      noticeHardwareKeyboard()
    }
  }

  const focusSheet = () => rootRef.current?.focus({ preventScroll: true })

  // After a structural change the cursor may point past the end of a measure.
  const clampToContent = (c: TabContent): Cursor => {
    const mm = Math.min(cursor.m, c.measures.length - 1)
    return { ...cursor, m: mm, b: Math.min(cursor.b, c.measures[mm].beats.length - 1) }
  }

  return (
    <div className="tab-editor">
      <div className="tab-toolbar" role="toolbar" aria-label={t('tab.toolbar')}>
        <div className="segmented" role="group" aria-label={t('tab.duration')}>
          {DURATIONS.map((d) => (
            <button key={d} aria-pressed={beat?.duration === d} onClick={() => onChange((c) => setDuration(c, cursor.m, cursor.b, d))} title={t('tab.duration')}>
              {DURATION_LABEL[d]}
            </button>
          ))}
        </div>
        <button className="btn" aria-pressed={!!beat?.dotted} onClick={() => onChange((c) => toggleDot(c, cursor.m, cursor.b))} title={`${t('tab.dot')} (.)`}>
          {t('tab.dot')}
        </button>
        <span className="tab-toolbar-sep" />
        <button className="btn" onClick={addBeat} title={`${t('tab.addBeat')} (Enter)`}>+ {t('tab.beat')}</button>
        <button className="btn" onClick={removeBeat}>− {t('tab.beat')}</button>
        <button className="btn" onClick={() => onChange((c) => clearBeat(c, cursor.m, cursor.b))}>{t('tab.clearBeat')}</button>
        <span className="tab-toolbar-sep" />
        <button className="btn" onClick={addMeasure}>+ {t('tab.measure')}</button>
        <button className="btn" onClick={removeMeasure}>− {t('tab.measure')}</button>
        <select
          className="select"
          aria-label={t('tab.measureTs')}
          title={t('tab.measureTs')}
          value={content.measures[cursor.m]?.timeSignature?.join('/') ?? ''}
          onChange={(e) => {
            const v = e.target.value
            onChange((c) => setMeasureTs(c, cursor.m, v ? (v.split('/').map(Number) as [number, number]) : null, timeSignature))
          }}
        >
          <option value="">{t('tab.tsInherit', { ts: tsAt({ ...content, measures: content.measures.slice(0, cursor.m) }, cursor.m - 1, timeSignature).join('/') })}</option>
          {TIME_SIGNATURES.map((x) => (
            <option key={x} value={x}>{t('tab.tsChange', { ts: x })}</option>
          ))}
        </select>
        <button className="btn" onClick={() => setChordBeat({ m: cursor.m, b: cursor.b })} title={`${t('chord.title')} (C)`}>
          {t('chord.button')}{beat?.chord ? `：${beat.chord}` : ''}
        </button>
        <button className="btn" onClick={() => setFitMeasure(cursor.m)} title={`${t('fit.title')} (F)`}>{t('fit.button')}</button>
        <span className="spacer" />
        <button className="btn btn-icon" onClick={undo} disabled={!canUndo} title={`${t('tab.undo')} (⌘Z)`} aria-label={t('tab.undo')}>
          <Icon name="undo" />
        </button>
        <button className="btn btn-icon" onClick={redo} disabled={!canRedo} title={`${t('tab.redo')} (⇧⌘Z)`} aria-label={t('tab.redo')}>
          <Icon name="redo" />
        </button>
        <button className="btn" onClick={() => setTidyOpen(true)} title={t('tidy.title')}>{t('tidy.button')}</button>
        <button className="btn" onClick={() => setTextOpen(true)}>{t('textTab.button')}</button>
        <button className="btn" onClick={() => setHelp(true)} title="?">{t('tab.shortcutsButton')}</button>
        <button className="btn" aria-pressed={keypad} onClick={() => setKeypad(!keypad)}>{t('tab.keypad')}</button>
      </div>

      <SelectionBar sel={sel} />

      <div className="tab-techniques" role="toolbar" aria-label={t('tech.title')}>
        {TECHNIQUES.map((tech) => (
          <button
            key={tech}
            className="btn tech-btn"
            aria-pressed={isOn(tech, note, beat?.tuplet)}
            onClick={() => {
              applyTechnique(tech)
              focusSheet()
            }}
            title={`${t(`tech.${tech}`)} (${TECHNIQUE_KEYS[tech]})`}
          >
            {t(`tech.${tech}Short`)}
            {tech === 'bend' && note?.bend ? ` ${BEND_LABEL[note.bend]}` : ''}
            {tech === 'tuplet' && beat?.tuplet ? ` ${beat.tuplet}` : ''}
            <kbd>{TECHNIQUE_KEYS[tech]}</kbd>
          </button>
        ))}
      </div>

      <div ref={rootRef} className="tab-sheet" tabIndex={0} onKeyDown={onKeyDown} aria-label={t('tab.editorLabel')}>
        {content.measures.map((measure, m) => {
          const fill = measure.free ? 0 : measureFill(measure, tsAt(content, m, timeSignature))
          return (
            <div key={measure.id} className={`tab-measure${fill > 0 ? ' over' : fill < 0 ? ' under' : ''}`}>
              <div className="tab-measure-head">
                <button className="measure-no" title={t('select.measureHint')} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (sel.onMeasureHead(m, e), focusSheet())}>
                  {m + 1}
                </button>
                {measure.timeSignature && <span className="tab-ts">{measure.timeSignature.join('/')}</span>}
                {measure.free && <span className="muted">{t('fit.freeBadge')}</span>}
                {fill !== 0 && (
                  <button
                    className="tab-fill"
                    title={t('fit.title')}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setFitMeasure(m)}
                  >
                    {fill > 0 ? t('tab.over') : t('tab.under')} · {t('fit.button')}
                  </button>
                )}
              </div>
              <div className="tab-grid" style={{ '--beats': measure.beats.length, '--strings': strings } as CSSProperties}>
                {measure.beats.map((bt, b) => (
                  <div key={bt.id} className={`tab-col${cursor.m === m && cursor.b === b ? ' active' : ''}${playing?.m === m && playing.b === b ? ' playing' : ''}${sel.isSelected(m, b) ? ' selected' : ''}`}>
                    <div
                      className="tab-chord"
                      title={t('chord.title')}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        setCursor({ ...cursor, m, b })
                        setChordBeat({ m, b })
                      }}
                    >
                      {bt.chord ?? ''}
                    </div>
                    {Array.from({ length: strings }, (_, i) => {
                      const s = i + 1
                      const n = bt.notes.find((x) => x.string === s)
                      const isCursor = cursor.m === m && cursor.b === b && cursor.s === s
                      const parts = n && cellParts(n)
                      return (
                        <div
                          key={s}
                          className={`tab-cell${isCursor ? ' cursor' : ''}`}
                          onPointerDown={(e) => {
                            e.preventDefault()
                            sel.onCellDown({ m, b }, e)
                            setCursor({ m, b, s })
                            focusSheet()
                          }}
                          onPointerEnter={(e) => sel.onCellEnter({ m, b }, e)}
                        >
                          {parts && (
                            <span className={`tab-fret${n.tie ? ' tied' : ''}`}>
                              {parts.pre && <span className="tab-mark">{parts.pre}</span>}
                              {parts.main}
                              {parts.post && <span className="tab-mark">{parts.post}</span>}
                            </span>
                          )}
                        </div>
                      )
                    })}
                    <div className="tab-dur">
                      {DURATION_LABEL[bt.duration]}
                      {bt.dotted ? '.' : ''}
                      {bt.tuplet ? SUPERSCRIPT[bt.tuplet] : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="tab-status muted small">
        {t('tab.position', { m: cursor.m + 1, b: cursor.b + 1, s: cursor.s, note: noteName(tuning[cursor.s - 1] ?? 0) })}
        {note && !note.dead && ` · ${noteName((tuning[cursor.s - 1] ?? 0) + note.fret, true)}`}
        <span className="tab-hint"> · {t('tab.helpHint')}</span>
      </div>

      {keypad && (
        <div className="tab-keypad" role="group" aria-label={t('tab.keypad')}>
          {Array.from({ length: frets + 1 }, (_, f) => (
            <button key={f} className={note && !note.dead && note.fret === f ? 'on' : ''} onClick={() => enterFret(f)}>{f}</button>
          ))}
          <button onClick={() => enterFret(null)} aria-label={t('tab.clearNote')}>⌫</button>
          <button onClick={() => move(-1)} aria-label="←">←</button>
          <button onClick={() => setCursor({ ...cursor, s: Math.max(1, cursor.s - 1) })} aria-label="↑">↑</button>
          <button onClick={() => setCursor({ ...cursor, s: Math.min(strings, cursor.s + 1) })} aria-label="↓">↓</button>
          <button onClick={() => move(1)} aria-label="→">→</button>
          <button onClick={addBeat} aria-label={t('tab.addBeat')}>↵</button>
        </div>
      )}

      <Modal open={help} onClose={() => setHelp(false)} title={t('tab.shortcutsTitle')} actions={<button className="btn btn-primary" onClick={() => setHelp(false)}>{t('common.close')}</button>}>
        <table className="shortcut-table">
          <tbody>
            {(
              [
                ['0–9', t('keys.fret')],
                ['← →  Space', t('keys.moveBeat')],
                ['↑ ↓', t('keys.moveString')],
                ['Enter', t('tab.addBeat')],
                ['Backspace', t('tab.clearNote')],
                ['.', t('tab.dot')],
                ['+  −', t('keys.duration')],
                ['⌘Z  ⇧⌘Z', `${t('tab.undo')} / ${t('tab.redo')}`],
                ['C', t('chord.title')],
                ['⇧← ⇧→', t('select.keyExtend')],
                ['⌘A', t('select.keyAll')],
                ['⌘C ⌘X', `${t('select.copy')} / ${t('select.cut')}`],
                ['⌘V', t('select.paste')],
                ['⇧⌘V', t('select.pasteOver')],
                ['Delete / ⇧Delete', `${t('select.clear')} / ${t('select.delete')}`],
                ['F', t('fit.title')],
              ] as [string, string][]
            ).map(([k, v]) => (
              <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>
            ))}
            {TECHNIQUES.map((tech) => (
              <tr key={tech}><td><kbd>{TECHNIQUE_KEYS[tech]}</kbd></td><td>{t(`tech.${tech}`)}</td></tr>
            ))}
          </tbody>
        </table>
      </Modal>

      <ChordDialog
        open={!!chordBeat}
        initial={chordBeat ? content.measures[chordBeat.m]?.beats[chordBeat.b]?.chord : undefined}
        used={[...new Set(content.measures.flatMap((mm) => mm.beats.flatMap((bb) => (bb.chord ? [bb.chord] : []))))]}
        tuning={tuning}
        frets={frets}
        onClose={() => {
          setChordBeat(null)
          focusSheet()
        }}
        onSetName={(name) => chordBeat && onChange((c) => setChord(c, chordBeat.m, chordBeat.b, name))}
        onApplyShape={(name, v) => chordBeat && onChange((c) => applyShape(setChord(c, chordBeat.m, chordBeat.b, name), chordBeat.m, chordBeat.b, v.frets))}
      />

      <FitDialog
        measure={fitMeasure}
        content={content}
        base={timeSignature}
        onApply={(next) => {
          onChange(() => next)
          setCursor(clampToContent(next))
        }}
        onClose={() => {
          setFitMeasure(null)
          focusSheet()
        }}
      />

      <TidyDialog open={tidyOpen} onClose={() => setTidyOpen(false)} content={content} timeSignature={timeSignature} onApply={(next) => onChange(() => next)} />

      <TextTabDialog
        open={textOpen}
        onClose={() => setTextOpen(false)}
        content={content}
        tuning={tuning}
        timeSignature={timeSignature}
        onApply={(next) => {
          onChange(() => next)
          setCursor({ m: 0, b: 0, s: 1 })
        }}
      />
    </div>
  )
}
