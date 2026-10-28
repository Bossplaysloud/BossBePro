// "Tidy" for AI transcriptions (and any sheet): repairs the common ways a transcription breaks
// BePro's format, and reports what it changed.

import { chordsAboveToInline, cleanLabel, detectCapo, formatBars, formatPattern, joinBarsWithLyric, leadingSectionName, parseBarLine, parseChart, type ChordChartContent } from './chordChart'
import { parseChord } from './chords'
import {
  fillWithRests,
  measureCapacity,
  measureFill,
  measureTicks,
  overflowToNewMeasure,
  reflowFrom,
  scaleMeasure,
  stepBeat,
  tsAt,
  type Beat,
  type Content,
  type Measure,
} from './rhythm'
import type { TabNote } from './tab'

export type LengthFix = 'smart' | 'reflow' | 'none'

export interface TidyOptions {
  /** Measure indexes where each image after the first starts (multi-image recognition). */
  overlaps?: number[]
  length: LengthFix
  chords: boolean
  techniques: boolean
  emptyEdges: boolean
}

export interface TidyReport {
  overlaps: number // duplicated bars removed
  lengths: number // bars whose length was fixed
  chordsFixed: number
  chordsRemoved: number
  techniques: number // techniques / ties corrected
  empty: number // empty bars removed at the start/end
}

export const emptyReport = (): TidyReport => ({ overlaps: 0, lengths: 0, chordsFixed: 0, chordsRemoved: 0, techniques: 0, empty: 0 })

// ---------- chord names ----------

/** Fixes common chord-name variants (full-width, ♯/♭, lowercase roots, "min"); null if still unreadable. */
export function normalizeChordName(raw: string): string | null {
  let s = raw.normalize('NFKC').replace(/\s+/g, '').replace(/♯/g, '#').replace(/♭/g, 'b').replace(/△/g, 'maj')
  s = s.replace(/^([a-g])/, (c) => c.toUpperCase()).replace(/\/([a-g])/, (_, c: string) => `/${c.toUpperCase()}`)
  s = s.replace(/^([A-G][#b]?)min(?!or)/, '$1m').replace(/^([A-G][#b]?)minor/, '$1m').replace(/^([A-G][#b]?)major/, '$1')
  return parseChord(s) ? s : null
}

// ---------- notes ----------

const keyOf = (n: { midi?: number; string?: number; fret?: number; dead?: boolean }) =>
  n.midi !== undefined ? `p${n.midi}` : `s${n.string}:${n.dead ? 'x' : n.fret}`

const beatSig = (b: Beat) => `${b.duration}${b.dotted ? '.' : ''}${b.tuplet ?? ''}|${b.notes.map((n) => keyOf(n as never)).sort().join(',')}`
const measureSig = (m: Measure) => m.beats.map(beatSig).join(' ')

/** At each image boundary, drops leading bars of the next image that repeat the previous image's last bars. */
function removeOverlaps<C extends Content>(c: C, boundaries: number[], report: TidyReport): C {
  const measures = [...c.measures]
  // Work from the last boundary so earlier indexes stay valid.
  for (const start of [...boundaries].sort((a, b) => b - a)) {
    if (start <= 0 || start >= measures.length) continue
    const prevEnd = start // bars [.., start) belong to the previous image
    const nextImageEnd = boundaries.filter((b) => b > start).sort((a, b) => a - b)[0] ?? measures.length
    let best = 0
    for (let k = Math.min(prevEnd, nextImageEnd - start); k >= 1; k--) {
      const tail = measures.slice(prevEnd - k, prevEnd).map(measureSig)
      const head = measures.slice(start, start + k).map(measureSig)
      const hasNotes = measures.slice(start, start + k).some((m) => m.beats.some((b) => b.notes.length > 0))
      if (hasNotes && tail.join('|') === head.join('|')) {
        best = k
        break
      }
    }
    if (best) {
      measures.splice(start, best)
      report.overlaps += best
    }
  }
  return { ...c, measures }
}

/** Removes techniques that need a following note (hammer/pull/slide-to) when there is none, and ties with nothing to tie to. */
function fixTechniques<C extends Content>(c: C, report: TidyReport): C {
  const measures = c.measures.map((m) => ({ ...m, beats: m.beats.map((b) => ({ ...b, notes: [...b.notes] })) }))
  const next = { ...c, measures }
  measures.forEach((measure, mi) =>
    measure.beats.forEach((beat, bi) => {
      beat.notes = beat.notes.map((note) => {
        const n = { ...note } as TabNote & { midi?: number }
        const cur = { m: mi, b: bi, s: 1 }
        const after = stepBeat(next, cur, 1)
        const before = stepBeat(next, cur, -1)
        const sameString = (pos: typeof after) => (pos ? (measures[pos.m].beats[pos.b].notes as (TabNote & { midi?: number })[]) : []).find((x) => (n.midi !== undefined ? true : x.string === n.string))
        if (n.dead && (n.legato || n.slide || n.bend || n.harmonic || n.vibrato || n.tap || n.tie)) {
          report.techniques++
          return { string: n.string, fret: 0, dead: true }
        }
        if ((n.legato || n.slide === 'to') && !sameString(after)) {
          report.techniques++
          delete n.legato
          if (n.slide === 'to') delete n.slide
        }
        if (n.tie) {
          const prev = sameString(before)
          const matches = prev && !prev.dead && (n.midi !== undefined ? prev.midi === n.midi : prev.fret === n.fret)
          if (!matches) {
            report.techniques++
            delete n.tie
          }
        }
        return n
      })
    }),
  )
  return next
}

function fixChords<C extends Content>(c: C, report: TidyReport): C {
  return {
    ...c,
    measures: c.measures.map((m) => ({
      ...m,
      beats: m.beats.map((b) => {
        if (!b.chord) return b
        const fixed = normalizeChordName(b.chord)
        if (fixed === b.chord) return b
        if (fixed) {
          report.chordsFixed++
          return { ...b, chord: fixed }
        }
        report.chordsRemoved++
        const { chord: _c, ...rest } = b
        void _c
        return rest
      }),
    })),
  }
}

function isEmptyMeasure(m: Measure) {
  return m.beats.every((b) => b.notes.length === 0 && !b.chord && !b.lyric)
}

function trimEmptyEdges<C extends Content>(c: C, report: TidyReport): C {
  let start = 0
  let end = c.measures.length
  while (start < end - 1 && isEmptyMeasure(c.measures[start]) && !c.measures[start + 1].timeSignature) start++
  while (end - 1 > start && isEmptyMeasure(c.measures[end - 1])) end--
  report.empty += start + (c.measures.length - end)
  if (!start && end === c.measures.length) return c
  const measures = c.measures.slice(start, end)
  // Keep the time signature that was in effect at the new first bar.
  if (start > 0 && !measures[0].timeSignature) {
    const ts = c.measures.slice(0, start).reverse().find((m) => m.timeSignature)?.timeSignature
    if (ts) measures[0] = { ...measures[0], timeSignature: ts }
  }
  return { ...c, measures }
}

/** Per bar: scale durations when the bar is exactly 2× / ½× / 4× / ¼× too long, else pad with rests or move the overflow to a new bar. */
function fixLengthsSmart<C extends Content>(c: C, base: [number, number], report: TidyReport): C {
  let next = c
  for (let m = next.measures.length - 1; m >= 0; m--) {
    const measure = next.measures[m]
    const ts = tsAt(next, m, base)
    if (measure.free || Math.abs(measureFill(measure, ts)) <= 1) continue
    report.lengths++
    const ratio = measureTicks(measure) / measureCapacity(ts)
    const steps = Math.log2(ratio)
    if (Math.abs(steps - Math.round(steps)) < 0.001 && Math.round(steps) !== 0) {
      let scaled: C | null = next
      for (let k = 0; k < Math.abs(Math.round(steps)) && scaled; k++) scaled = scaleMeasure(scaled, m, steps > 0 ? 2 : 0.5)
      if (scaled) {
        next = scaled
        continue
      }
    }
    next = ratio < 1 ? fillWithRests(next, m, base) : overflowToNewMeasure(next, m, base)
  }
  return next
}

export function tidyContent<C extends Content>(content: C, base: [number, number], o: TidyOptions): { content: C; report: TidyReport } {
  const report = emptyReport()
  let c = content
  if (o.overlaps?.length) c = removeOverlaps(c, o.overlaps, report)
  if (o.chords) c = fixChords(c, report)
  if (o.techniques) c = fixTechniques(c, report)
  if (o.emptyEdges) c = trimEmptyEdges(c, report)
  if (o.length === 'smart') c = fixLengthsSmart(c, base, report)
  if (o.length === 'reflow') {
    const off = c.measures.filter((m, i) => !m.free && Math.abs(measureFill(m, tsAt(c, i, base))) > 1).length
    if (off) {
      report.lengths += off
      c = reflowFrom(c, 0, base)
    }
  }
  return { content: c, report }
}

// ---------- chord charts ----------

export interface ChartReport {
  converted: boolean
  repaired: number // broken brackets and doubled chords
  chordsFixed: number
  blankLines: number
  capo: number | null
}

export function tidyChart(chart: ChordChartContent): { content: ChordChartContent; report: ChartReport } {
  const report: ChartReport = { converted: false, repaired: 0, chordsFixed: 0, blankLines: 0, capo: null }
  let text = chordsAboveToInline(chart.text)
  report.converted = text !== chart.text
  // A chord written inside another, e.g. "[D/[G/B]F#]" → "[D/F#][G/B]".
  text = text.replace(/\[([^[\]]*)\[([^[\]]*)\]([^[\]]*)\]/g, (all, a: string, inner: string, c: string) => {
    const outer = normalizeChordName(a + c)
    const nested = normalizeChordName(inner)
    if (!outer && !nested) return all
    report.repaired++
    return `${outer ? `[${outer}]` : ''}${nested ? `[${nested}]` : ''}`
  })
  // Older or hand-typed forms → the current ones (counted as repairs).
  text = text
    .split(/\r?\n/)
    .map((line) => {
      const parsed = parseChart(line)
      // Pattern lines: "# 指法：…" → "[指法] …", and incomplete marks spelled out ("↑_↑↓" → "↑_↑__↓__").
      if (parsed[0]?.type === 'pattern') {
        const p = parsed[0]
        const beats = p.beats.filter((b) => b !== '|')
        const barsAfter = p.beats.flatMap((b, i) => (b === '|' ? [] : [p.beats[i + 1] === '|']))
        const text = formatPattern(
          beats.map((b) => ({ symbols: b.symbols.map((x) => ({ text: x.text, duration: b.tuplet ? 8 : 4 * 2 ** x.lines, dotted: x.dotted })) })),
          barsAfter,
        )
        const formatted = `[${p.label}] ${text}`
        if (formatted !== line.trim()) report.repaired++
        return formatted
      }
      // "[(1) [間奏1]]" → "[(1) 間奏1]"
      if (parsed.length === 1 && parsed[0].type === 'section' && line.trim() !== `[${parsed[0].label}]`) {
        report.repaired++
        return `[${parsed[0].label}]`
      }
      // "| G | D/F# |" → "| [G] | [D/F#] |" (also a heading on the same line goes to its own line)
      const barsAt = parsed.findIndex((l) => l.type === 'bars')
      if (barsAt >= 0) {
        const bars = parsed[barsAt] as Extract<ReturnType<typeof parseChart>[number], { type: 'bars' }>
        const head = barsAt === 1 && parsed[0].type === 'section' ? `[${parsed[0].label}]\n` : ''
        const formatted = head + formatBars(bars)
        if (formatted !== line.trim()) report.repaired++
        return formatted
      }
      return line
    })
    .join('\n')
  text = liftChartSections(text, report)
  // The same chord twice in a row with nothing between: "[G][G]" → "[G]".
  text = text.replace(/\[([^[\]]+)\](\s*)\[\1\]/g, (_all, c: string) => {
    report.repaired++
    return `[${c}]`
  })
  text = text.replace(/\[([^\]]+)\]/g, (all, inner: string) => {
    const fixed = normalizeChordName(inner)
    if (!fixed || fixed === inner) return all // section labels and unknown text stay as they are
    report.chordsFixed++
    return `[${fixed}]`
  })
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t　]+$/, ''))
  const out: string[] = []
  for (const line of lines) {
    if (!line.trim() && (!out.length || !out[out.length - 1].trim())) {
      report.blankLines++
      continue
    }
    out.push(line)
  }
  while (out.length && !out[out.length - 1].trim()) {
    out.pop()
    report.blankLines++
  }
  const capo = !chart.capo ? detectCapo(text) : null
  report.capo = capo
  return { content: { ...chart, text: out.join('\n'), ...(capo ? { capo } : {}) }, report }
}

/**
 * Section names that ended up inside a line ("[間奏2] [D][F#m/C#]…", "(2) [間奏3]") become headings;
 * "(1)" alone joins the heading after it; a bar line followed by a lyric line without chords
 * (the chord row and lyric row of one line, read apart) is joined back into one line.
 */
function liftChartSections(text: string, report: ChartReport): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    const parsed = parseChart(line)
    if (parsed.length !== 1 || parsed[0].type !== 'lyric') {
      out.push(line)
      continue
    }
    const lifted = leadingSectionName(line)
    if (!lifted) {
      out.push(line)
      continue
    }
    report.repaired++
    out.push(`[${lifted.label}]`)
    if (!lifted.rest.trim()) continue
    // Only chords left: an instrumental bar line.
    const rest = parseChart(lifted.rest)[0]
    const chordsOnly = rest?.type === 'lyric' && rest.segments.every((g) => !g.text.trim() && (!g.chord || parseChord(g.chord)))
    out.push(chordsOnly ? formatBars({ items: [{ type: 'bar', chords: rest.segments.flatMap((g) => (g.chord ? [g.chord] : [])) }] }) : lifted.rest)
  }
  // "[(1)]" then "[間奏1]" → "[(1) 間奏1]"
  const headings: string[] = []
  for (let i = 0; i < out.length; i++) {
    const h = parseChart(out[i])
    let j = i + 1
    while (j < out.length && !out[j].trim()) j++
    const next = j < out.length ? parseChart(out[j]) : []
    if (h.length === 1 && h[0].type === 'section' && /^\(\d+\)$/.test(h[0].label) && next.length === 1 && next[0].type === 'section') {
      headings.push(`[${cleanLabel(`${h[0].label} ${next[0].label}`)}]`)
      report.repaired++
      i = j
      continue
    }
    headings.push(out[i])
  }
  // A bar line without repeat marks, then (after blank lines) a lyric line without chords → one line.
  const joined: string[] = []
  for (let i = 0; i < headings.length; i++) {
    const bars = parseBarLine(headings[i])
    let j = i + 1
    while (j < headings.length && !headings[j].trim() && j - i <= 2) j++
    const next = j < headings.length ? parseChart(headings[j]) : []
    const words = next.length === 1 && next[0].type === 'lyric' && next[0].segments.every((g) => !g.chord) && !!headings[j].trim()
    if (bars && bars.items.every((it) => it.type === 'bar') && words) {
      joined.push(joinBarsWithLyric(bars.items, headings[j].trim()))
      report.repaired++
      i = j
      continue
    }
    joined.push(headings[i])
  }
  return joined.join('\n')
}
