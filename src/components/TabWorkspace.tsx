import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Sheet } from '../db/db'
import { updateSheet } from '../db/repo'
import { tabToAlphaTex } from '../music/alphatex'
import { sheetFrets, sheetProgram } from '../music/instruments'
import { chordAt, clampCursor, customSpan, emptyTab, fretsUsed, isTabContent, rangeFor, setNote, type Cursor, type TabContent } from '../music/tab'
import { useHistory } from '../lib/useHistory'
import { useAutosave } from '../lib/useAutosave'
import { useSheetPlayer } from '../lib/useSheetPlayer'
import { useCustomRange, useRangeSize, useSheetMode } from '../lib/settings'
import { FretPanel } from './FretPanel'
import { PlayerBar } from './PlayerBar'
import { ScoreView } from './ScoreView'
import { TabEditor } from './TabEditor'

/** Edit/view workspace for a TAB sheet. Mount with `key={sheet.id}` so switching sheets starts fresh. */
export function TabWorkspace({ sheet }: { sheet: Sheet }) {
  const { t } = useTranslation()
  const [mode, setMode] = useSheetMode()
  const [initial] = useState<TabContent>(() => (isTabContent(sheet.content) ? sheet.content : emptyTab(sheet.timeSignature)))
  const history = useHistory(initial)
  const content = history.value
  const strings = sheet.tuning.length
  const frets = sheetFrets(sheet)
  const program = sheetProgram(sheet)
  const [rawCursor, setCursor] = useState<Cursor>({ m: 0, b: 0, s: 1 })
  const cursor = clampCursor(content, rawCursor, strings)
  const [viewFocus, setViewFocus] = useState(0)
  const [rangeSize] = useRangeSize()
  const [customRange, setCustomRange] = useCustomRange(sheet.id)

  useAutosave(sheet.id, content, initial)

  const tex = useMemo(
    () => tabToAlphaTex(content, { title: sheet.title, tempo: sheet.tempo, tuning: sheet.tuning, timeSignature: sheet.timeSignature, program }),
    [content, sheet.title, sheet.tempo, sheet.tuning, sheet.timeSignature, program],
  )
  const [playingPos, setPlayingPos] = useState<{ m: number; b: number } | null>(null)
  const focus = playingPos ? playingPos.m : mode === 'edit' ? cursor.m : Math.min(viewFocus, content.measures.length - 1)
  const player = useSheetPlayer(tex, mode === 'view', focus)
  const playing = player.playing
  // A custom fretboard range covers the measures from its first note to its last.
  const span = rangeSize < 0 && customRange ? customSpan(customRange, content.measures.length) : null
  const range: [number, number] = span ? [span.from.m, span.to.m + 1] : rangeFor(focus, rangeSize, content.measures.length)

  const shown = playing ?? (mode === 'edit' ? { m: cursor.m, b: cursor.b } : null)
  const currentNotes = shown ? content.measures[shown.m]?.beats[shown.b]?.notes : undefined
  const currentChord = shown ? chordAt(content, shown.m, shown.b) : undefined

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
        <TabEditor
          content={content}
          onChange={(fn) => history.set(fn)}
          cursor={cursor}
          setCursor={setCursor}
          playing={playing}
          tuning={sheet.tuning}
          frets={frets}
          timeSignature={sheet.timeSignature}
          undo={history.undo}
          redo={history.redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
        />
      )}
      <ScoreView
        tex={player.playerTex}
        visible={mode === 'view'}
        range={range}
        onMeasureClick={setViewFocus}
        onApi={player.setApi}
        onBeat={(p) => {
          player.setPlaying(p)
          setPlayingPos(p)
        }}
        onStatus={player.onStatus}
        onMidiReady={player.onMidiReady}
      />

      <FretPanel
        total={content.measures.length}
        range={range}
        uses={fretsUsed(content, range[0], range[1], strings, span)}
        custom={customRange}
        onCustom={setCustomRange}
        cursor={mode === 'edit' ? { m: cursor.m, b: cursor.b } : null}
        rangeChord={chordAt(content, range[0], 0) ?? content.measures.slice(range[0], range[1]).flatMap((m) => m.beats).find((b) => b.chord)?.chord}
        tuning={sheet.tuning}
        frets={frets}
        keyName={sheet.key}
        currentChord={currentChord}
        setFocus={(m) => (mode === 'edit' ? setCursor({ ...cursor, m, b: 0 }) : setViewFocus(m))}
        current={currentNotes?.filter((n) => !n.dead)}
        onCellClick={
          mode === 'edit'
            ? (s, f) => {
                history.set((c) => setNote(c, { ...cursor, s }, f, frets))
                setCursor({ ...cursor, s })
              }
            : undefined
        }
      />
    </>
  )
}
