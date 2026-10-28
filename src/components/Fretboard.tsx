import { noteName } from '../music/instruments'

export interface FretMark {
  string: number // 1 = highest string (top row)
  fret: number
  label: string
  count?: number
  current?: boolean // highlighted (e.g. the beat under the cursor)
  root?: boolean // root of the chord / "1" of the key
  faint?: boolean // reference only (e.g. chord tones not played)
  alt?: boolean // another place to play a pitch (outline)
}

interface Props {
  tuning: number[]
  marks: FretMark[]
  frets?: number // how many frets to draw; defaults to fit the marks (min 12)
  capo?: number // draws a capo behind this fret and dims the frets below it
  onCellClick?: (string: number, fret: number) => void
}

const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21, 27, 29, 31, 33]
const COL = 46
const ROW = 30
const LEFT = 34 // string-name column
const NUT = 38 // open-string column
const TOP = 8
const BOTTOM = 26 // fret-number row

/** Horizontal fingerboard, highest string on top to match TAB. Scrolls horizontally on narrow screens. */
export function Fretboard({ tuning, marks, frets, capo = 0, onCellClick }: Props) {
  const strings = tuning.length
  const maxUsed = marks.reduce((m, x) => Math.max(m, x.fret), 0)
  const count = frets ?? Math.min(36, Math.max(12, maxUsed + 2))
  const width = LEFT + NUT + count * COL + 8
  const height = TOP + strings * ROW + BOTTOM
  const y = (s: number) => TOP + (s - 0.5) * ROW
  const x = (f: number) => (f === 0 ? LEFT + NUT / 2 : LEFT + NUT + (f - 0.5) * COL)
  const fretLine = (f: number) => LEFT + NUT + f * COL
  const boardTop = y(1) - ROW / 2 + 4
  const boardBottom = y(strings) + ROW / 2 - 4

  return (
    <div className="fretboard" role="img" aria-label="fretboard">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <rect className="fb-wood" x={LEFT + NUT} y={boardTop} width={count * COL} height={boardBottom - boardTop} rx={3} />
        {INLAYS.filter((f) => f <= count).map((f) => (
          <circle key={f} className="fb-inlay" cx={x(f)} cy={(boardTop + boardBottom) / 2} r={5} />
        ))}
        {[12, 24, 36].filter((f) => f <= count).map((f) => (
          <g key={f}>
            <circle className="fb-inlay" cx={x(f)} cy={boardTop + (boardBottom - boardTop) * 0.28} r={5} />
            <circle className="fb-inlay" cx={x(f)} cy={boardTop + (boardBottom - boardTop) * 0.72} r={5} />
          </g>
        ))}
        {Array.from({ length: count + 1 }, (_, f) => (
          <line key={f} className={f === 0 ? 'fb-nut' : 'fb-fret'} x1={fretLine(f)} x2={fretLine(f)} y1={boardTop} y2={boardBottom} />
        ))}
        {capo > 0 && capo <= count && (
          <g pointerEvents="none">
            <rect className="fb-capo-shade" x={LEFT} y={boardTop} width={fretLine(capo - 1) + COL * 0.55 - LEFT} height={boardBottom - boardTop} />
            <rect className="fb-capo" x={fretLine(capo) - COL * 0.38} y={boardTop - 5} width={9} height={boardBottom - boardTop + 10} rx={4} />
          </g>
        )}
        {tuning.map((midi, i) => (
          <g key={i}>
            <text className="fb-label" x={LEFT / 2} y={y(i + 1)} dominantBaseline="central" textAnchor="middle">{noteName(midi)}</text>
            <line className="fb-string" x1={LEFT + 6} x2={fretLine(count)} y1={y(i + 1)} y2={y(i + 1)} strokeWidth={0.8 + (i / Math.max(1, strings - 1)) * 1.6} />
          </g>
        ))}
        {Array.from({ length: count + 1 }, (_, f) => (
          <text key={f} className="fb-number" x={x(f)} y={height - BOTTOM / 2} dominantBaseline="central" textAnchor="middle">{f}</text>
        ))}
        {onCellClick &&
          tuning.map((_, i) =>
            Array.from({ length: count + 1 }, (_, f) => (
              <rect
                key={`${i}-${f}`}
                className="fb-cell"
                x={f === 0 ? LEFT : fretLine(f - 1)}
                y={y(i + 1) - ROW / 2}
                width={f === 0 ? NUT : COL}
                height={ROW}
                onClick={() => onCellClick(i + 1, f)}
              />
            )),
          )}
        {marks
          .filter((mk) => mk.string >= 1 && mk.string <= strings && mk.fret <= count)
          // Faint reference marks first so played notes draw on top.
          .sort((a, b) => Number(!!b.faint || !!b.alt) - Number(!!a.faint || !!a.alt))
          .map((mk) => (
            <g
              key={`${mk.string}-${mk.fret}`}
              className={`fb-mark${mk.current ? ' current' : ''}${mk.root ? ' root' : ''}${mk.faint ? ' faint' : ''}${mk.alt ? ' alt' : ''}`}
              pointerEvents="none"
            >
              <circle cx={x(mk.fret)} cy={y(mk.string)} r={12} />
              <text x={x(mk.fret)} y={y(mk.string)} dominantBaseline="central" textAnchor="middle" style={{ fontSize: mk.label.length > 2 ? 10 : 12 }}>
                {mk.label}
              </text>
              {mk.count && mk.count > 1 && !mk.current ? (
                <text className="fb-count" x={x(mk.fret) + 13} y={y(mk.string) - 10} textAnchor="middle">{mk.count}</text>
              ) : null}
            </g>
          ))}
      </svg>
    </div>
  )
}
