import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  defaultSpelling,
  degreeToMidi,
  letterToMidi,
  noteAt,
  previousPitch,
  setPitch,
  shiftOctave,
  shiftSemitone,
  spelledName,
  toNumbered,
  toggleMelodyTie,
  type MelodyContent,
} from '../music/melody'
import {
  DURATIONS,
  TIME_SIGNATURES,
  clearBeat,
  cycleTuplet,
  deleteBeat,
  deleteMeasure,
  insertBeatAfter,
  insertMeasureAfter,
  measureFill,
  setChord,
  setDuration,
  setLyric,
  setMeasureTs,
  stepBeat,
  toggleDot,
  tsAt,
  type Cursor,
} from '../music/rhythm'
import { useKeypad } from '../lib/settings'
import { tabToMelody } from '../music/convert'
import { SelectionBar, useBeatSelection } from './BeatSelection'
import { ChordDialog } from './ChordDialog'
import { FitDialog } from './FitDialog'
import { Icon } from './Icon'
import { JianpuGlyph } from './Jianpu'
import { Modal } from './Modal'
import { TidyDialog } from './TidyDialog'
import { DURATION_LABEL } from './TabEditor'
import { useToast } from './Toast'

const SUPERSCRIPT: Record<number, string> = { 3: '³', 5: '⁵', 6: '⁶' }
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

interface Props {
  notation: 'numbered' | 'staff'
  content: MelodyContent
  onChange: (fn: (c: MelodyContent) => MelodyContent) => void
  cursor: Cursor
  setCursor: (c: Cursor) => void
  playing?: { m: number; b: number } | null
  keyName: string
  /** MIDI note written as plain "1" (numbered notation). */
  base: number
  tuning: number[]
  frets: number
  timeSignature: [number, number]
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function MelodyEditor(props: Props) {
  const { notation, content, onChange, cursor, setCursor, playing, keyName, base, tuning, frets, timeSignature, undo, redo, canUndo, canRedo } = props
  const { t } = useTranslation()
  const toast = useToast()
  const [keypad, setKeypad] = useKeypad()
  const [help, setHelp] = useState(false)
  const [chordBeat, setChordBeat] = useState<{ m: number; b: number } | null>(null)
  const [fitMeasure, setFitMeasure] = useState<number | null>(null)
  const [lyricOpen, setLyricOpen] = useState(false)
  const [tidyOpen, setTidyOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const sawHardwareKey = useRef(false)
  const beat = content.measures[cursor.m]?.beats[cursor.b]
  const note = noteAt(content, cursor.m, cursor.b)
  const spelling = defaultSpelling(keyName)
  const sel = useBeatSelection({
    content,
    onChange,
    cursor,
    setCursor,
    timeSignature,
    kind: 'melody',
    adapt: (clip) => {
      const mel = tabToMelody({ kind: 'tab', version: 1, measures: (clip.measures ?? [{ id: 'clip', beats: clip.beats }]) as never }, tuning)
      return clip.measures ? { beats: mel.measures.flatMap((m) => m.beats), measures: mel.measures } : { beats: mel.measures[0].beats }
    },
  })

  useEffect(() => {
    rootRef.current?.querySelector('.mel-col.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [cursor])
  useEffect(() => {
    if (playing) rootRef.current?.querySelector('.mel-col.playing')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [playing])

  const focusSheet = () => rootRef.current?.focus({ preventScroll: true })
  const near = () => note?.midi ?? previousPitch(content, cursor)

  const enterDegree = (d: number) => onChange((c) => setPitch(c, cursor.m, cursor.b, degreeToMidi(d, base, near())))
  const enterLetter = (l: string) => onChange((c) => setPitch(c, cursor.m, cursor.b, letterToMidi(l, near() ?? base + 12)))
  const clear = () => onChange((c) => setPitch(c, cursor.m, cursor.b, null))
  const octave = (dir: 1 | -1) => (note ? onChange((c) => shiftOctave(c, cursor.m, cursor.b, dir)) : toast(t('tech.needNote')))
  const semitone = (dir: 1 | -1) => (note ? onChange((c) => shiftSemitone(c, cursor.m, cursor.b, dir)) : toast(t('tech.needNote')))
  const tie = () => {
    const next = toggleMelodyTie(content, cursor)
    if (next === content) return toast(t('melody.noTieSource'))
    onChange(() => next)
  }

  const move = (dir: 1 | -1) => {
    const next = stepBeat(content, cursor, dir)
    if (next) return setCursor(next)
    if (dir === 1) {
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
    // In staff mode plain letters enter notes, so the letter shortcuts need Shift there.
    const letterShortcut = (k: string) => key === k.toUpperCase() || (notation === 'numbered' && key === k)
    const handled = (() => {
      if (notation === 'numbered' && /^[1-7]$/.test(key)) return enterDegree(Number(key)), true
      if (notation === 'numbered' && key === '0') return clear(), true
      if (notation === 'staff' && /^[a-g]$/.test(key)) return enterLetter(key), true
      if (letterShortcut('c')) return setChordBeat({ m: cursor.m, b: cursor.b }), true
      if (letterShortcut('l')) return setLyricOpen(true), true
      if (letterShortcut('f')) return setFitMeasure(cursor.m), true
      if (key === 't' || key === 'T') return tie(), true
      if (key === 'u' || key === 'U') return onChange((c) => cycleTuplet(c, cursor.m, cursor.b)), true
      switch (key) {
        case 'Backspace':
        case 'Delete':
          return clear(), true
        case 'ArrowUp':
          return octave(1), true
        case 'ArrowDown':
          return octave(-1), true
        case ']':
        case '#':
          return semitone(1), true
        case '[':
          return semitone(-1), true
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
          return changeDuration(1), true
        case '+':
        case '=':
          return changeDuration(-1), true
        case '?':
          return setHelp(true), true
      }
      return false
    })()
    if (handled) {
      e.preventDefault()
      if (!sawHardwareKey.current) {
        sawHardwareKey.current = true
        if (keypad && matchMedia('(pointer: coarse)').matches) {
          setKeypad(false)
          toast(t('tab.keyboardDetected'))
        }
      }
    }
  }

  const label = (midi: number, sp?: 'sharp' | 'flat') => spelledName(midi, sp ?? spelling)
  const statusNote = note
    ? `${label(note.midi, note.spelling)}${notation === 'numbered' ? (() => { const g = toNumbered(note.midi, base, note.spelling); return `（${g.accidental}${g.digit}）` })() : ''}`
    : t('melody.rest')

  return (
    <div className="tab-editor">
      <div className="tab-toolbar" role="toolbar" aria-label={t('tab.toolbar')}>
        <div className="segmented" role="group" aria-label={t('tab.duration')}>
          {DURATIONS.map((d) => (
            <button key={d} aria-pressed={beat?.duration === d} onClick={() => onChange((c) => setDuration(c, cursor.m, cursor.b, d))}>
              {DURATION_LABEL[d]}
            </button>
          ))}
        </div>
        <button className="btn" aria-pressed={!!beat?.dotted} onClick={() => onChange((c) => toggleDot(c, cursor.m, cursor.b))} title={`${t('tab.dot')} (.)`}>{t('tab.dot')}</button>
        <button className="btn" aria-pressed={!!beat?.tuplet} onClick={() => onChange((c) => cycleTuplet(c, cursor.m, cursor.b))} title={`${t('tech.tuplet')} (U)`}>
          {t('tech.tupletShort')}{beat?.tuplet ? ` ${beat.tuplet}` : ''}
        </button>
        <button className="btn" aria-pressed={!!note?.tie} onClick={tie} title={`${t('tech.tie')} (T)`}>{t('tech.tieShort')}</button>
        <span className="tab-toolbar-sep" />
        <button className="btn" onClick={() => semitone(1)} title="♯ (])">♯</button>
        <button className="btn" onClick={() => semitone(-1)} title="♭ ([)">♭</button>
        <button className="btn" onClick={() => octave(1)} title={`${t('melody.octaveUp')} (↑)`}>8va</button>
        <button className="btn" onClick={() => octave(-1)} title={`${t('melody.octaveDown')} (↓)`}>8vb</button>
        <span className="tab-toolbar-sep" />
        <button className="btn" onClick={addBeat} title={`${t('tab.addBeat')} (Enter)`}>+ {t('tab.beat')}</button>
        <button className="btn" onClick={removeBeat}>− {t('tab.beat')}</button>
        <button className="btn" onClick={() => onChange((c) => clearBeat(c, cursor.m, cursor.b))}>{t('tab.clearBeat')}</button>
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
          {TIME_SIGNATURES.map((x) => <option key={x} value={x}>{t('tab.tsChange', { ts: x })}</option>)}
        </select>
        <button className="btn" onClick={() => setChordBeat({ m: cursor.m, b: cursor.b })} title={`${t('chord.title')} (${notation === 'staff' ? '⇧C' : 'C'})`}>
          {t('chord.button')}{beat?.chord ? `：${beat.chord}` : ''}
        </button>
        <button className="btn" onClick={() => setLyricOpen(true)} title={`${t('melody.lyric')} (${notation === 'staff' ? '⇧L' : 'L'})`}>{t('melody.lyric')}</button>
        <button className="btn" onClick={() => setFitMeasure(cursor.m)} title={`${t('fit.title')} (${notation === 'staff' ? '⇧F' : 'F'})`}>{t('fit.button')}</button>
        <span className="spacer" />
        <button className="btn btn-icon" onClick={undo} disabled={!canUndo} aria-label={t('tab.undo')} title={`${t('tab.undo')} (⌘Z)`}><Icon name="undo" /></button>
        <button className="btn btn-icon" onClick={redo} disabled={!canRedo} aria-label={t('tab.redo')} title={`${t('tab.redo')} (⇧⌘Z)`}><Icon name="redo" /></button>
        <button className="btn" onClick={() => setTidyOpen(true)} title={t('tidy.title')}>{t('tidy.button')}</button>
        <button className="btn" onClick={() => setHelp(true)}>{t('tab.shortcutsButton')}</button>
        <button className="btn" aria-pressed={keypad} onClick={() => setKeypad(!keypad)}>{t('tab.keypad')}</button>
      </div>

      <SelectionBar sel={sel} />

      <div ref={rootRef} className={`tab-sheet mel-sheet ${notation}`} tabIndex={0} onKeyDown={onKeyDown} aria-label={t('melody.editorLabel')}>
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
                  <button className="tab-fill" onPointerDown={(e) => e.stopPropagation()} onClick={() => setFitMeasure(m)}>
                    {fill > 0 ? t('tab.over') : t('tab.under')} · {t('fit.button')}
                  </button>
                )}
              </div>
              <div className="mel-grid">
                {measure.beats.map((bt, b) => {
                  const n = bt.notes[0]
                  const active = cursor.m === m && cursor.b === b
                  return (
                    <div
                      key={bt.id}
                      className={`mel-col${active ? ' active' : ''}${playing?.m === m && playing.b === b ? ' playing' : ''}${sel.isSelected(m, b) ? ' selected' : ''}`}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        sel.onCellDown({ m, b }, e)
                        setCursor({ m, b, s: 1 })
                        focusSheet()
                      }}
                      onPointerEnter={(e) => sel.onCellEnter({ m, b }, e)}
                    >
                      <div className="tab-chord" onPointerDown={() => setChordBeat({ m, b })}>{bt.chord ?? ''}</div>
                      <div className={`mel-note${active ? ' cursor' : ''}`}>
                        {notation === 'numbered' ? (
                          <JianpuGlyph beat={bt} base={base} />
                        ) : n ? (
                          <span className={n.tie ? 'tab-fret tied' : 'tab-fret'}>{label(n.midi, n.spelling)}</span>
                        ) : (
                          <span className="muted small">{t('melody.restShort')}</span>
                        )}
                      </div>
                      <div className="mel-lyric">{bt.lyric ?? ''}</div>
                      <div className="tab-dur">
                        {DURATION_LABEL[bt.duration]}
                        {bt.dotted ? '.' : ''}
                        {bt.tuplet ? SUPERSCRIPT[bt.tuplet] : ''}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="tab-status muted small">
        {t('melody.position', { m: cursor.m + 1, b: cursor.b + 1, note: statusNote })}
        <span className="tab-hint"> · {t('tab.helpHint')}</span>
      </div>

      {keypad && (
        <div className="tab-keypad mel-keypad" role="group" aria-label={t('tab.keypad')}>
          {notation === 'numbered'
            ? [1, 2, 3, 4, 5, 6, 7].map((d) => <button key={d} onClick={() => enterDegree(d)}>{d}</button>)
            : LETTERS.map((l) => <button key={l} onClick={() => enterLetter(l.toLowerCase())}>{l}</button>)}
          <button onClick={clear} aria-label={t('melody.rest')}>{notation === 'numbered' ? '0' : t('melody.restShort')}</button>
          <button onClick={() => semitone(1)}>♯</button>
          <button onClick={() => semitone(-1)}>♭</button>
          <button onClick={() => octave(1)} aria-label={t('melody.octaveUp')}>↑8</button>
          <button onClick={() => octave(-1)} aria-label={t('melody.octaveDown')}>↓8</button>
          <button onClick={tie}>{t('tech.tieShort')}</button>
          <button onClick={() => move(-1)} aria-label="←">←</button>
          <button onClick={() => move(1)} aria-label="→">→</button>
          <button onClick={addBeat} aria-label={t('tab.addBeat')}>↵</button>
        </div>
      )}

      <Modal open={help} onClose={() => setHelp(false)} title={t('tab.shortcutsTitle')} actions={<button className="btn btn-primary" onClick={() => setHelp(false)}>{t('common.close')}</button>}>
        <table className="shortcut-table">
          <tbody>
            {(
              [
                notation === 'numbered' ? ['1–7', t('melody.keyDegree')] : ['A–G', t('melody.keyLetter')],
                [notation === 'numbered' ? '0  Backspace' : 'Backspace', t('melody.rest')],
                ['↑ ↓', `${t('melody.octaveUp')} / ${t('melody.octaveDown')}`],
                ['] [', '♯ / ♭'],
                ['← →  Space', t('keys.moveBeat')],
                ['Enter', t('tab.addBeat')],
                ['.', t('tab.dot')],
                ['+  −', t('keys.duration')],
                ['T', t('tech.tie')],
                ['U', t('tech.tuplet')],
                [notation === 'staff' ? '⇧C' : 'C', t('chord.title')],
                [notation === 'staff' ? '⇧L' : 'L', t('melody.lyric')],
                [notation === 'staff' ? '⇧F' : 'F', t('fit.title')],
                ['⌘Z  ⇧⌘Z', `${t('tab.undo')} / ${t('tab.redo')}`],
                ['⇧← ⇧→', t('select.keyExtend')],
                ['⌘A', t('select.keyAll')],
                ['⌘C ⌘X', `${t('select.copy')} / ${t('select.cut')}`],
                ['⌘V', t('select.paste')],
                ['⇧⌘V', t('select.pasteOver')],
                ['Delete / ⇧Delete', `${t('select.clear')} / ${t('select.delete')}`],
              ] as [string, string][]
            ).map(([k, v]) => (
              <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>
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
      />

      <LyricDialog
        open={lyricOpen}
        content={content}
        cursor={cursor}
        onSave={(text) => onChange((c) => setLyric(c, cursor.m, cursor.b, text || null))}
        onNext={() => {
          // Jump to the next beat that has a note (lyrics follow sung notes).
          let pos: Cursor | null = cursor
          while ((pos = stepBeat(content, pos, 1))) {
            const n = noteAt(content, pos.m, pos.b)
            if (n && !n.tie) return setCursor(pos)
          }
          setLyricOpen(false)
        }}
        onClose={() => {
          setLyricOpen(false)
          focusSheet()
        }}
      />

      <TidyDialog open={tidyOpen} onClose={() => setTidyOpen(false)} content={content} timeSignature={timeSignature} onApply={(next) => onChange(() => next)} />

      <FitDialog
        measure={fitMeasure}
        content={content}
        base={timeSignature}
        onApply={(next) => {
          onChange(() => next)
          const mm = Math.min(cursor.m, next.measures.length - 1)
          setCursor({ ...cursor, m: mm, b: Math.min(cursor.b, next.measures[mm].beats.length - 1) })
        }}
        onClose={() => {
          setFitMeasure(null)
          focusSheet()
        }}
      />
    </div>
  )
}

/** Lyric entry for one beat at a time: Enter saves and moves to the next note, Esc closes. */
function LyricDialog({ open, content, cursor, onSave, onNext, onClose }: {
  open: boolean
  content: MelodyContent
  cursor: Cursor
  onSave: (text: string) => void
  onNext: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const current = content.measures[cursor.m]?.beats[cursor.b]?.lyric ?? ''

  useEffect(() => {
    if (!open || !inputRef.current) return
    inputRef.current.value = current
    inputRef.current.focus()
    inputRef.current.select()
  }, [open, cursor.m, cursor.b, current])

  const commit = () => onSave(inputRef.current?.value.trim() ?? '')

  return (
    <Modal
      open={open}
      onClose={() => (commit(), onClose())}
      title={t('melody.lyricTitle', { m: cursor.m + 1, b: cursor.b + 1 })}
      actions={
        <>
          <button className="btn" onClick={() => (commit(), onClose())}>{t('common.close')}</button>
          <button className="btn btn-primary" onClick={() => (commit(), onNext())}>{t('melody.lyricNext')}</button>
        </>
      }
    >
      <input
        ref={inputRef}
        className="input"
        placeholder={t('melody.lyricPlaceholder')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            commit()
            onNext()
          }
        }}
      />
      <p className="muted small" style={{ margin: 0 }}>{t('melody.lyricHint')}</p>
    </Modal>
  )
}
