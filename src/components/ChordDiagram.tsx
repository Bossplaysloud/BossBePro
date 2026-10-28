import type { Voicing } from '../music/chords'

/** Small vertical chord box: lowest string on the left, nut (or start fret) on top. */
export function ChordDiagram({ voicing }: { voicing: Voicing }) {
  const strings = voicing.frets.length
  const fretted = voicing.frets.filter((f): f is number => f !== null && f > 0)
  const top = fretted.length && Math.max(...fretted) > 4 ? Math.min(...fretted) : 1
  const rows = 4
  const gap = 12
  const left = 14
  const head = 14
  const w = left + (strings - 1) * gap + 10
  const h = head + rows * 14 + 6
  const col = (i: number) => left + (strings - 1 - i) * gap // string 1 (highest) on the right
  return (
    <svg className="chord-diagram" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {top > 1 && <text x={2} y={head + 10} className="cd-text">{top}</text>}
      <line x1={left} x2={col(0)} y1={head} y2={head} className={top === 1 ? 'cd-nut' : 'cd-line'} />
      {Array.from({ length: rows }, (_, r) => (
        <line key={r} x1={left} x2={col(0)} y1={head + (r + 1) * 14} y2={head + (r + 1) * 14} className="cd-line" />
      ))}
      {voicing.frets.map((f, i) => (
        <g key={i}>
          <line x1={col(i)} x2={col(i)} y1={head} y2={head + rows * 14} className="cd-line" />
          {f === null ? (
            <text x={col(i)} y={head - 4} textAnchor="middle" className="cd-text">×</text>
          ) : f === 0 ? (
            <circle cx={col(i)} cy={head - 7} r={3.5} className="cd-open" />
          ) : (
            <circle cx={col(i)} cy={head + (f - top + 0.5) * 14} r={4.5} className="cd-dot" />
          )}
        </g>
      ))}
    </svg>
  )
}
