import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ZoomSelect } from './ZoomSelect'
import type { Sheet } from '../db/db'
import { chartChords, chordsAboveToInline, detectCapo, emptyChordChart, isChordChartContent, parseChart, transposeContent, transposeChordName, type ChordChartContent } from '../music/chordChart'
import { chordDegree, findVoicings, parseChord, transposeKey, voicingLabel, type Voicing } from '../music/chords'
import { noteName, sheetFrets } from '../music/instruments'
import { useAutosave } from '../lib/useAutosave'
import { useHistory } from '../lib/useHistory'
import { useFretLabels, useScoreZoom, useSheetMode, useTwoPage } from '../lib/settings'
import { ChordDiagram } from './ChordDiagram'
import { ChordDialog } from './ChordDialog'
import { Fretboard, type FretMark } from './Fretboard'
import { Icon } from './Icon'
import { ChartTidyDialog } from './TidyDialog'
import { useToast } from './Toast'

/** Lyrics with chords: a text editor with live preview, plus fretboard and shapes for the selected chord. */
export function ChordChartWorkspace({ sheet }: { sheet: Sheet }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [mode, setMode] = useSheetMode()
  const [initial] = useState<ChordChartContent>(() => (isChordChartContent(sheet.content) ? sheet.content : emptyChordChart()))
  const history = useHistory(initial)
  const content = history.value
  const setText = (text: string) => history.set((c) => (c.text === text ? c : { ...c, text }))
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [inserting, setInserting] = useState(false)
  const [tidyOpen, setTidyOpen] = useState(false)
  const chords = useMemo(() => chartChords(content.text), [content.text])
  const [selected, setSelected] = useState<string | null>(null)
  const active = selected && parseChord(selected) ? selected : chords[0] ?? null

  useAutosave(sheet.id, content, initial)

  const insertChord = (name: string) => {
    const el = textRef.current
    const at = el ? el.selectionStart : content.text.length
    const next = `${content.text.slice(0, at)}[${name}]${content.text.slice(at)}`
    setText(next)
    setSelected(name)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.selectionStart = el.selectionEnd = at + name.length + 2
    })
  }

  const transpose = content.transpose ?? 0
  const capo = content.capo ?? 0
  const meta = content.meta
  // sheet.key is the original key; the chart's current key follows the transposition.
  const currentKey = transposeKey(sheet.key, transpose)
  const soundingKey = transposeKey(currentKey, capo)
  const shift = (semitones: number) => history.set((c) => transposeContent(c, semitones))
  const setCapo = (n: number) => history.set((c) => (n ? { ...c, capo: n } : (({ capo: _c, ...rest }) => (void _c, rest))(c)))

  const convert = () => {
    const next = chordsAboveToInline(content.text)
    const foundCapo = !capo ? detectCapo(content.text) : null
    if (next === content.text && !foundCapo) return toast(t('chart.nothingToConvert'))
    history.set((c) => ({ ...c, text: next, ...(foundCapo ? { capo: foundCapo } : {}) }))
    toast(foundCapo ? t('chart.convertedCapo', { capo: foundCapo }) : t('chart.converted'))
  }

  const status = (
    <div className="chart-status">
      <span className={`chip-static${transpose ? ' on' : ''}`}>
        {transpose
          ? t('chart.transposed', { steps: `${transpose > 0 ? '+' : '−'}${Math.abs(transpose)}`, from: sheet.key, to: currentKey })
          : t('chart.writtenKey', { key: sheet.key })}
      </span>
      {meta?.originalKey && <span className="chip-static">{t('chart.songKey', { key: meta.originalKey })}</span>}
      {capo > 0 && <span className="chip-static on">{t('chart.capoInfo', { capo, shape: currentKey, sound: soundingKey })}</span>}
      {(meta?.maleKey || meta?.femaleKey) && (
        <span className="chip-static">
          {[meta.maleKey && t('chart.maleKey', { key: meta.maleKey }), meta.femaleKey && t('chart.femaleKey', { key: meta.femaleKey })].filter(Boolean).join(' · ')}
        </span>
      )}
      {(meta?.tempo || meta?.timeSignature) && (
        <span className="chip-static">{[meta.tempo && `♩=${meta.tempo}`, meta.timeSignature].filter(Boolean).join(' · ')}</span>
      )}
    </div>
  )

  const preview = <ChartPreview text={content.text} active={active} onChord={setSelected} large={mode === 'view'} header={status} />

  return (
    <>
      <div className="mode-bar">
        <div className="segmented" role="group">
          <button aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>{t('tab.edit')}</button>
          <button aria-pressed={mode === 'view'} onClick={() => setMode('view')}>{t('tab.view')}</button>
        </div>
        <span className="spacer" />
        <div className="row" role="group" aria-label={t('chart.transpose')} style={{ gap: 4 }}>
          <span className="small muted">{t('chart.transpose')}</span>
          <button className="btn btn-icon" onClick={() => shift(-1)} aria-label={t('chart.down')} title={t('chart.down')}>−</button>
          <span className="transpose-amount" aria-live="polite">{transpose > 0 ? `+${transpose}` : transpose < 0 ? `−${-transpose}` : '0'}</span>
          <button className="btn btn-icon" onClick={() => shift(1)} aria-label={t('chart.up')} title={t('chart.up')}>+</button>
          {transpose !== 0 && <button className="btn" onClick={() => shift(-transpose)}>{t('chart.reset')}</button>}
        </div>
        <label className="row small" style={{ gap: 4 }}>
          <span className="muted">Capo</span>
          <select className="select" style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} value={capo} onChange={(e) => setCapo(Number(e.target.value))}>
            <option value={0}>{t('chart.noCapo')}</option>
            {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{t('chart.capoN', { n })}</option>)}
          </select>
        </label>
        <button className="btn btn-icon" onClick={history.undo} disabled={!history.canUndo} aria-label={t('tab.undo')} title={t('tab.undo')}><Icon name="undo" /></button>
        <button className="btn btn-icon" onClick={history.redo} disabled={!history.canRedo} aria-label={t('tab.redo')} title={t('tab.redo')}><Icon name="redo" /></button>
      </div>

      {mode === 'edit' ? (
        <div className="chart-edit">
          <div className="chart-source">
            <div className="tab-toolbar">
              <button className="btn" onClick={() => setInserting(true)}>{t('chart.insertChord')}</button>
              <button className="btn" onClick={convert} title={t('chart.convertHint')}>{t('chart.convert')}</button>
              <button className="btn" onClick={() => setTidyOpen(true)}>{t('tidy.button')}</button>
            </div>
            <textarea
              ref={textRef}
              className="input mono chart-textarea"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={content.text}
              placeholder={t('chart.placeholder')}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="muted small" style={{ margin: 0 }}>{t('chart.syntax')}</p>
          </div>
          <div className="chart-preview-wrap">{preview}</div>
        </div>
      ) : (
        preview
      )}

      <ChordPanel chords={chords} active={active} onSelect={setSelected} sheet={sheet} capo={capo} flats={/b/.test(soundingKey)} />

      <ChartTidyDialog open={tidyOpen} onClose={() => setTidyOpen(false)} chart={content} onApply={(next) => history.set(() => next)} />

      <ChordDialog
        open={inserting}
        used={chords}
        tuning={sheet.tuning}
        frets={sheetFrets(sheet)}
        onClose={() => setInserting(false)}
        onSetName={(name) => name && insertChord(name)}
      />
    </>
  )
}

export function ChartPreview({ text, active, onChord, large, header, zoomable = large }: { text: string; active: string | null; onChord: (c: string) => void; large: boolean; header: ReactNode; zoomable?: boolean }) {
  const { t } = useTranslation()
  const [zoom] = useScoreZoom()
  const [twoPage] = useTwoPage()
  const lines = useMemo(() => parseChart(text), [text])
  if (!text.trim()) return <div className="placeholder">{t('chart.empty')}</div>
  return (
    <>
    {zoomable && <ZoomSelect />}
    <div className={`chart-preview${large ? ' large' : ''}${large && twoPage ? ' two-page' : ''}`} style={zoomable && zoom !== 100 ? { zoom: zoom / 100 } : undefined}>
      {header}
      {lines.map((line, i) => {
        if (line.type === 'blank') return <div key={i} className="chart-blank" />
        if (line.type === 'section') return <div key={i} className="chart-section">{line.label}</div>
        if (line.type === 'comment') return <div key={i} className="chart-comment">{line.text}</div>
        if (line.type === 'bars') {
          const lastBar = line.items.map((it) => it.type).lastIndexOf('bar')
          return (
            <div key={i} className="chart-bars">
              {line.items.map((item, j) =>
                item.type === 'mark' ? (
                  <span key={j} className="chart-repeat">{item.text.replace(/^[x×X]\s*(\d+)$/, '×$1').replace(/^(\d+)\s*[x×X]$/, '×$1')}</span>
                ) : (
                  <span key={j} className={`chart-bar${j === lastBar ? ' last' : ''}`}>
                    {item.chords.map((c, k) => (
                      <span key={k} className={`chart-chord${c === active ? ' active' : ''}${!parseChord(c) ? ' filler' : ''}`} onClick={() => parseChord(c) && onChord(c)}>
                        {c}
                      </span>
                    ))}
                  </span>
                ),
              )}
            </div>
          )
        }
        if (line.type === 'pattern')
          return (
            <div key={i} className="chart-pattern">
              <span className="chart-pattern-label">{line.label}</span>
              {line.beats.map((beat, j) =>
                beat === '|' ? (
                  <span key={j} className="chart-pattern-bar" aria-hidden="true" />
                ) : (
                  <span key={j} className="chart-pattern-beat">
                    {beat.tuplet && <span className="chart-pattern-tuplet">{beat.tuplet}</span>}
                    {beat.symbols.map((sym, k) => (
                      <span key={k} className={`chart-pattern-sym${/^[-–0·]$/.test(sym.text) ? ' rest' : ''}`} style={{ '--ul': sym.lines } as CSSProperties}>
                        {sym.text === '-' ? '–' : sym.text}
                        {sym.dotted && <span className="chart-pattern-dot">.</span>}
                      </span>
                    ))}
                  </span>
                ),
              )}
            </div>
          )
        return (
          <div key={i} className="chart-line">
            {line.segments.map((s, j) => (
              <span key={j} className="chart-seg">
                <span
                  className={`chart-chord${s.chord && s.chord === active ? ' active' : ''}${s.chord && !parseChord(s.chord) ? ' invalid' : ''}`}
                  onClick={() => s.chord && onChord(s.chord)}
                >
                  {s.chord ?? ''}
                </span>
                <span className="chart-text">{s.text || ' '}</span>
              </span>
            ))}
          </div>
        )
      })}
    </div>
    </>
  )
}

/** The selected chord on the fretboard (every chord tone, root in yellow) and its playable shapes. */
function ChordPanel({ chords, active, onSelect, sheet, capo, flats }: { chords: string[]; active: string | null; onSelect: (c: string) => void; sheet: Sheet; capo: number; flats: boolean }) {
  const { t } = useTranslation()
  const [labels, setLabels] = useFretLabels()
  const [shape, setShape] = useState<Voicing | null>(null)
  const frets = sheetFrets(sheet)
  const chord = active ? parseChord(active) : null
  // Shapes are found as if the capo were the nut; on the fretboard they move up by `capo`.
  const voicings = useMemo(() => (chord ? findVoicings(chord, sheet.tuning, frets - capo, 8) : []), [chord, sheet.tuning, frets, capo])
  // With a capo, the sounding chord is higher than the written (fingered) one.
  const sounding = chord && capo ? parseChord(transposeChordName(active!, capo, false)) : chord
  const shown = shape && voicings.some((v) => v.frets.join() === shape.frets.join()) ? shape : null

  const marks: FretMark[] = []
  if (sounding) {
    sheet.tuning.forEach((open, i) => {
      for (let f = capo; f <= frets; f++) {
        const midi = open + f
        if (!sounding.degrees.has((((midi - sounding.root) % 12) + 12) % 12)) continue
        const inShape = shown?.frets[i] !== null && shown?.frets[i] !== undefined && shown.frets[i]! + capo === f
        if (shown && !inShape) continue
        marks.push({
          string: i + 1,
          fret: f,
          label: labels === 'note' ? noteName(midi) : chordDegree(midi, sounding),
          root: midi % 12 === sounding.root,
          faint: !shown,
        })
      }
    })
  }

  return (
    <section className="fret-panel chord-panel" aria-label={t('chart.panel')}>
      <div className="fret-panel-head">
        <strong>{t('fretboard.title')}</strong>
        <div className="row" style={{ gap: 4 }}>
          {chords.map((c) => (
            <button key={c} className="btn chip" aria-pressed={c === active} onClick={() => (onSelect(c), setShape(null))}>{c}</button>
          ))}
        </div>
        <span className="spacer" />
        <div className="segmented" role="group" aria-label={t('fretboard.labels')}>
          <button aria-pressed={labels === 'degree'} onClick={() => setLabels('degree')}>{t('fretboard.degree')}</button>
          <button aria-pressed={labels === 'note'} onClick={() => setLabels('note')}>{t('fretboard.note')}</button>
        </div>
      </div>
      {chord ? (
        <>
          <Fretboard tuning={sheet.tuning} frets={frets} marks={marks} capo={capo} />
          <div className="fb-legend row">
            <span>{shown ? t('chart.shapeShown', { shape: voicingLabel(shown) }) : t('chart.allTones', { chord: active })}</span>
            {capo > 0 && <span>{t('chart.capoPanel', { capo, chord: active, sound: transposeChordName(active!, capo, flats) })}</span>}
          </div>
          {voicings.length > 0 && (
            <div className="voicing-grid" style={{ marginTop: 8 }}>
              {voicings.map((v) => (
                <button
                  key={v.frets.join()}
                  className={`voicing${shown?.frets.join() === v.frets.join() ? ' selected' : ''}`}
                  onClick={() => setShape(shown?.frets.join() === v.frets.join() ? null : v)}
                >
                  <ChordDiagram voicing={v} />
                  <span className="small">{voicingLabel(v)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>{t('chart.noChord')}</p>
      )}
    </section>
  )
}
