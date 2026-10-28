import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { keyTonic } from '../music/chords'
import { noteName } from '../music/instruments'
import { toNumbered, type MelodyBeat, type MelodyContent } from '../music/melody'
import { beatTicks, tsAt } from '../music/rhythm'
import { useScoreZoom, useTwoPage } from '../lib/settings'
import { ZoomSelect } from './ZoomSelect'

const SUPERSCRIPT: Record<number, string> = { 3: '³', 5: '⁵', 6: '⁶' }

/**
 * One beat in numbered notation: digit (0 = rest) with accidental, octave dots above/below,
 * underlines for 8th/16th/32nd, a dot for dotted values and dashes for half/whole notes.
 */
export function JianpuGlyph({ beat, base }: { beat: MelodyBeat; base: number }) {
  const n = beat.notes[0]
  const g = n ? toNumbered(n.midi, base, n.spelling) : null
  const underlines = beat.duration >= 8 ? Math.log2(beat.duration / 4) : 0
  // Quarter-note units beyond the first become dashes (half = 1, dotted half = 2, whole = 3).
  const quarters = beat.duration <= 4 ? Math.round(beatTicks({ duration: beat.duration, dotted: beat.dotted }) / 960) : 1
  const dashes = beat.duration <= 2 ? quarters - 1 : 0
  const showDot = beat.dotted && beat.duration >= 4
  return (
    <span className={`jp-glyph${n?.tie ? ' tied' : ''}`}>
      {beat.tuplet ? <span className="jp-tuplet">{SUPERSCRIPT[beat.tuplet]}</span> : null}
      <span className="jp-core">
        <span className="jp-dots above">{g && g.octave > 0 ? '•'.repeat(g.octave) : ''}</span>
        <span className="jp-num" style={{ '--ul': underlines } as CSSProperties}>
          {g?.accidental && <span className="jp-acc">{g.accidental}</span>}
          {g ? g.digit : 0}
        </span>
        <span className="jp-dots below">{g && g.octave < 0 ? '•'.repeat(-g.octave) : ''}</span>
      </span>
      {showDot && <span className="jp-aug">•</span>}
      {dashes > 0 && <span className="jp-dash">{' –'.repeat(dashes)}</span>}
    </span>
  )
}

interface ViewProps {
  content: MelodyContent
  base: number
  keyName: string
  timeSignature: [number, number]
  tempo: number
  title: string
  range: [number, number]
  playing: { m: number; b: number } | null
  onMeasureClick: (m: number) => void
  /** Follow the display size setting and show its selector (off where the page has its own sizing). */
  zoomable?: boolean
}

/** Read-only numbered-notation sheet: "1=G 4/4" header, bars, chords above, lyrics below. */
export function JianpuView({ content, base, keyName, timeSignature, tempo, title, range, playing, onMeasureClick, zoomable = true }: ViewProps) {
  const { t } = useTranslation()
  const [zoom] = useScoreZoom()
  const [twoPage] = useTwoPage()
  return (
    <>
    {zoomable && <ZoomSelect />}
    <div className={`jianpu-view${twoPage ? ' two-page' : ''}`} aria-label={t('sheetType.numbered')} style={zoomable && zoom !== 100 ? { zoom: zoom / 100 } : undefined}>
      <div className="jp-title">{title}</div>
      <div className="jp-header">
        <span>1 = {noteName(keyTonic(keyName))}</span>
        <span>{tsAt(content, 0, timeSignature).join('/')}</span>
        <span>♩ = {tempo}</span>
      </div>
      <div className="jp-lines">
        {content.measures.map((measure, m) => (
          <div key={measure.id} className={`jp-measure${m >= range[0] && m < range[1] ? ' in-range' : ''}`} onClick={() => onMeasureClick(m)}>
            {measure.timeSignature && m > 0 && <span className="jp-ts">{measure.timeSignature.join('/')}</span>}
            {measure.beats.map((beat, b) => (
              <span key={beat.id} className={`jp-beat${playing?.m === m && playing.b === b ? ' playing' : ''}`}>
                <span className="jp-chord">{beat.chord ?? ''}</span>
                <JianpuGlyph beat={beat} base={base} />
                <span className="jp-lyric">{beat.lyric ?? ''}</span>
              </span>
            ))}
            <span className="jp-bar" aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
    </>
  )
}
