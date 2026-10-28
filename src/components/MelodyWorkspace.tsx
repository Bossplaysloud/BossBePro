import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Sheet } from '../db/db'
import { updateSheet } from '../db/repo'
import { melodyToAlphaTex, type MelodyTexOptions } from '../music/alphatex'
import { sheetFrets, sheetProgram } from '../music/instruments'
import { keyTonic } from '../music/chords'
import { transposeChordName } from '../music/chordChart'
import { defaultSpelling, emptyMelody, isMelodyContent, numberedBase, positionsFor, setPitch, suggestPositions, transposeMelody, type MelodyContent, type Position } from '../music/melody'
import { chordAt, clampCursor, customSpan, inSpan, rangeFor, type Cursor } from '../music/rhythm'
import type { FretUse } from '../music/tab'
import { useAutosave } from '../lib/useAutosave'
import { useHistory } from '../lib/useHistory'
import { useCustomRange, useRangeSize, useSheetMode } from '../lib/settings'
import { useSheetPlayer } from '../lib/useSheetPlayer'
import { FretPanel } from './FretPanel'
import { JianpuView } from './Jianpu'
import { MelodyEditor } from './MelodyEditor'
import { PlayerBar } from './PlayerBar'
import { ScoreView } from './ScoreView'

const CLEF: Record<Sheet['instrument'], MelodyTexOptions['clef']> = { guitar: 'treble8', custom: 'treble8', bass: 'bass', ukulele: 'treble' }

/** Workspace for numbered-notation and staff sheets (same melody content, different display). */
export function MelodyWorkspace({ sheet }: { sheet: Sheet }) {
  const { t } = useTranslation()
  const notation = sheet.type === 'numbered' ? 'numbered' : 'staff'
  const [mode, setMode] = useSheetMode()
  const [initial] = useState<MelodyContent>(() => (isMelodyContent(sheet.content) ? sheet.content : emptyMelody(sheet.timeSignature)))
  const history = useHistory(initial)
  const content = history.value
  const frets = sheetFrets(sheet)
  const program = sheetProgram(sheet)
  const base = numberedBase(sheet.tuning, sheet.key)
  const [rawCursor, setCursor] = useState<Cursor>({ m: 0, b: 0, s: 1 })
  const cursor = clampCursor(content, rawCursor, 1)
  const [viewFocus, setViewFocus] = useState(0)
  const [rangeSize] = useRangeSize()
  const [customRange, setCustomRange] = useCustomRange(sheet.id)

  useAutosave(sheet.id, content, initial)

  // Numbered notation is relative to the key: a new key keeps the digits and moves the pitches
  // (and chord names) with it. Staff sheets keep their pitches; only the key signature changes.
  const [prevKey, setPrevKey] = useState(sheet.key)
  if (sheet.key !== prevKey) {
    setPrevKey(sheet.key)
    if (notation === 'numbered') {
      const delta = ((((keyTonic(sheet.key) - keyTonic(prevKey) + 6) % 12) + 12) % 12) - 6
      const flats = defaultSpelling(sheet.key) === 'flat'
      history.set((c) => {
        const moved = transposeMelody(c, delta)
        return {
          ...moved,
          measures: moved.measures.map((m) => ({
            ...m,
            beats: m.beats.map((b) => (b.chord ? { ...b, chord: transposeChordName(b.chord, delta, flats) } : b)),
          })),
        }
      })
    }
  }

  const tex = useMemo(
    () =>
      melodyToAlphaTex(content, {
        title: sheet.title,
        tempo: sheet.tempo,
        timeSignature: sheet.timeSignature,
        key: sheet.key,
        clef: CLEF[sheet.instrument],
        program,
      }),
    [content, sheet.title, sheet.tempo, sheet.timeSignature, sheet.key, sheet.instrument, program],
  )
  // Staff sheets show the score while editing too, as a live preview.
  const scoreVisible = notation === 'staff'
  const [playingPos, setPlayingPos] = useState<{ m: number; b: number } | null>(null)
  const focus = playingPos ? playingPos.m : mode === 'edit' ? cursor.m : Math.min(viewFocus, content.measures.length - 1)
  const player = useSheetPlayer(tex, scoreVisible, focus)
  // A custom fretboard range covers the measures from its first note to its last.
  const span = rangeSize < 0 && customRange ? customSpan(customRange, content.measures.length) : null
  const range: [number, number] = span ? [span.from.m, span.to.m + 1] : rangeFor(focus, rangeSize, content.measures.length)

  // Fretboard: one suggested place per pitch in the range, other places as outlines.
  const { uses, alternatives, suggestion } = useMemo(() => {
    const notes: { midi: number; chord?: string }[] = []
    let chord = range[0] > 0 ? chordAt(content, range[0] - 1, Infinity) : undefined
    for (const [mi, measure] of content.measures.slice(range[0], range[1]).entries()) {
      for (const [bi, beat] of measure.beats.entries()) {
        chord = beat.chord ?? chord
        if (!inSpan(span, range[0] + mi, bi)) continue
        const n = beat.notes[0]
        if (n && !n.tie && !n.dead) notes.push({ midi: n.midi, chord })
      }
    }
    const suggestion = suggestPositions(notes.map((n) => n.midi), sheet.tuning, frets)
    const counted = new Map<string, FretUse>()
    for (const n of notes) {
      const p = suggestion.get(n.midi)
      if (!p) continue
      const key = `${p.string}:${p.fret}`
      const u = counted.get(key)
      if (u) u.count++
      else counted.set(key, { ...p, count: 1, ...(n.chord ? { chord: n.chord } : {}) })
    }
    const alternatives: Position[] = [...new Set(notes.map((n) => n.midi))].flatMap((m) =>
      positionsFor(m, sheet.tuning, frets).filter((p) => !counted.has(`${p.string}:${p.fret}`)),
    )
    return { uses: [...counted.values()], alternatives, suggestion }
  }, [content, range, span, sheet.tuning, frets])

  const shown = player.playing ?? (mode === 'edit' ? { m: cursor.m, b: cursor.b } : null)
  const shownNote = shown ? content.measures[shown.m]?.beats[shown.b]?.notes[0] : undefined
  const currentPos = shownNote ? (suggestion.get(shownNote.midi) ?? positionsFor(shownNote.midi, sheet.tuning, frets)[0]) : undefined

  return (
    <>
      <div className="mode-bar">
        <div className="segmented" role="group">
          <button aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>{t('tab.edit')}</button>
          <button aria-pressed={mode === 'view'} onClick={() => setMode('view')}>{t('tab.view')}</button>
        </div>
      </div>

      <PlayerBar
        api={player.api}
        status={player.status}
        midiVersion={player.midiVersion}
        tempo={sheet.tempo}
        program={program}
        onProgram={(p) => void updateSheet(sheet.id, { program: p })}
        measures={content.measures.length}
        range={range}
        onPlay={player.onPlay}
        onStop={() => {
          player.onStop()
          setPlayingPos(null)
        }}
      />

      {mode === 'edit' && (
        <MelodyEditor
          notation={notation}
          content={content}
          onChange={(fn) => history.set(fn)}
          cursor={cursor}
          setCursor={setCursor}
          playing={player.playing}
          keyName={sheet.key}
          base={base}
          tuning={sheet.tuning}
          frets={frets}
          timeSignature={sheet.timeSignature}
          undo={history.undo}
          redo={history.redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
        />
      )}
      {mode === 'view' && notation === 'numbered' && (
        <JianpuView
          content={content}
          base={base}
          keyName={sheet.key}
          timeSignature={sheet.timeSignature}
          tempo={sheet.tempo}
          title={sheet.title}
          range={range}
          playing={player.playing}
          onMeasureClick={setViewFocus}
        />
      )}
      <div className={scoreVisible && mode === 'edit' ? 'score-preview' : undefined}>
        <ScoreView
          tex={player.playerTex}
          visible={scoreVisible}
          profile="score"
          range={range}
          onMeasureClick={(m) => (mode === 'edit' ? setCursor({ m, b: 0, s: 1 }) : setViewFocus(m))}
          onApi={player.setApi}
          onBeat={(p) => {
            player.setPlaying(p)
            setPlayingPos(p)
          }}
          onStatus={player.onStatus}
          onMidiReady={player.onMidiReady}
        />
      </div>

      <FretPanel
        total={content.measures.length}
        range={range}
        uses={uses}
        alternatives={alternatives}
        custom={customRange}
        onCustom={setCustomRange}
        cursor={mode === 'edit' ? { m: cursor.m, b: cursor.b } : null}
        rangeChord={chordAt(content, range[0], 0) ?? content.measures.slice(range[0], range[1]).flatMap((m) => m.beats).find((b) => b.chord)?.chord}
        tuning={sheet.tuning}
        frets={frets}
        keyName={sheet.key}
        currentChord={shown ? chordAt(content, shown.m, shown.b) : undefined}
        setFocus={(m) => (mode === 'edit' ? setCursor({ m, b: 0, s: 1 }) : setViewFocus(m))}
        current={currentPos ? [currentPos] : []}
        onCellClick={mode === 'edit' ? (str, f) => history.set((c) => setPitch(c, cursor.m, cursor.b, sheet.tuning[str - 1] + f)) : undefined}
      />
    </>
  )
}
