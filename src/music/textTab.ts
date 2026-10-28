// Plain-text ("ASCII") TAB, the format common on the web:
//
//    PM----
//   e|-----------0---|
//   B|---3h5---------|
//   G|-------7b9r7---|
//   D|-<12>----------|
//
// Text TAB has no rhythm, so parsing estimates durations from horizontal spacing,
// and serializing spaces notes by duration so a round trip keeps the rhythm close.

import { noteName } from './instruments'
import { beatTicks, measureCapacity, previousNote, splitTicks, type TabBeat, type TabContent, type TabMeasure, type TabNote } from './tab'

const uid = () => crypto.randomUUID()

// ---------- serialize ----------


function noteToken(n: TabNote, next: TabNote | undefined): string {
  if (n.dead) return 'x'
  // <12> natural harmonic, [12] artificial harmonic
  let t = n.harmonic === 'natural' ? `<${n.fret}>` : n.harmonic === 'artificial' ? `[${n.fret}]` : n.ghost ? `(${n.fret})` : String(n.fret)
  if (n.slide === 'inBelow') t = '/' + t
  if (n.slide === 'inAbove') t = '\\' + t
  if (n.tap) t = 't' + t
  if (n.bend) {
    t += `b${n.fret + Math.round(n.bend * 2)}`
    if (n.release) t += `r${n.fret}`
  }
  if (n.vibrato) t += '~'
  if (n.legato) t += n.legato
  if (n.slide === 'to') t += next && next.fret < n.fret ? '\\' : '/'
  if (n.slide === 'outDown') t += '\\'
  if (n.slide === 'outUp') t += '/'
  return t
}

function stringLabels(tuning: number[]) {
  const names = tuning.map((m) => noteName(m))
  // The conventional lowercase "e" marks the high string when two strings share a name.
  return names.map((n, i) => (i === 0 && names.slice(1).includes(n) ? n.toLowerCase() : n))
}

export function tabToText(content: TabContent, tuning: number[]): string {
  const strings = tuning.length
  const labels = stringLabels(tuning)
  const pad = Math.max(...labels.map((l) => l.length))
  const rows = labels.map((l) => l.padEnd(pad) + '|')
  let pm = ' '.repeat(pad + 1)
  let anyPm = false
  let prevMuted = false

  content.measures.forEach((measure) => {
    const tokenRows = measure.beats.map((beat, bi) =>
      Array.from({ length: strings }, (_, i) => {
        const n = beat.notes.find((x) => x.string === i + 1)
        if (!n || n.tie) return ''
        return noteToken(n, measure.beats[bi + 1]?.notes.find((x) => x.string === i + 1))
      }),
    )
    // Widths are proportional to duration (one 16th = `scale` columns) so the rhythm can be read back.
    const units = measure.beats.map((b) => Math.max(0.5, beatTicks(b) / 240))
    const scale = Math.max(1, ...tokenRows.map((tokens, bi) => Math.ceil((Math.max(...tokens.map((t) => t.length)) + 1) / units[bi])))
    measure.beats.forEach((beat, bi) => {
      const tokens = tokenRows[bi]
      const width = Math.max(Math.round(units[bi] * scale), ...tokens.map((t) => t.length + 1))
      const muted = beat.notes.some((n) => n.palmMute)
      anyPm ||= muted
      // "PM" opens a palm-mute span, dashes continue it over the following muted beats.
      pm += muted ? (prevMuted ? '' : 'PM').padEnd(width, '-') : ' '.repeat(width)
      prevMuted = muted
      rows.forEach((_, i) => (rows[i] += '-' + tokens[i].padEnd(width - 1, '-')))
    })
    rows.forEach((_, i) => (rows[i] += '-|'))
    pm += prevMuted ? '--' : '  '
  })

  return [...(anyPm ? [pm.replace(/\s+$/, '')] : []), ...rows].join('\n')
}

// ---------- parse ----------

export interface ParseResult {
  measures: TabMeasure[]
  noteCount: number
  /** Strings per block found in the text (used to warn when it differs from the sheet). */
  blockStrings: number[]
}

const LABEL = /^\s*([A-Ga-g][#b]?\s*)?[|:]/
const TAB_CHARS = /^[-–—0-9|:xXhHpPbBrRtT/\\~<>()[\]^vs.*\s]*$/

interface RawNote {
  col: number
  note: TabNote
}

function isTabLine(line: string) {
  const m = LABEL.exec(line)
  const body = m ? line.slice(m[0].length) : line
  return (body.match(/[-–—]/g)?.length ?? 0) >= 3 && TAB_CHARS.test(body)
}

/** Column where the TAB body starts (just after the "e|" label), or 0. */
function bodyStart(line: string) {
  const m = LABEL.exec(line)
  return m ? m[0].length : 0
}

function scanString(body: string, string: number, offset: number): RawNote[] {
  const out: RawNote[] = []
  let i = 0
  let tap = false // "t" marks the following fret as tapped (e.g. 5h7t12p7)
  const num = () => {
    const m = /^\d{1,2}/.exec(body.slice(i))
    if (!m) return null
    i += m[0].length
    return Number(m[0])
  }
  while (i < body.length) {
    const ch = body[i]
    const col = i + offset
    let note: TabNote | null = null
    let slideIn: TabNote['slide']
    if ((ch === 't' || ch === 'T') && /[\d/\\<[(]/.test(body[i + 1] ?? '')) {
      tap = true
      i++
      continue
    }
    if ((ch === '/' || ch === '\\') && /\d/.test(body[i + 1] ?? '')) {
      // slide into the note, only when directly followed by a fret
      slideIn = ch === '/' ? 'inBelow' : 'inAbove'
      i++
    }
    const c = body[i]
    if (/\d/.test(c)) {
      note = { string, fret: num()! }
    } else if (c === 'x' || c === 'X') {
      note = { string, fret: 0, dead: true }
      i++
    } else if ((c === '<' || c === '[') && /\d/.test(body[i + 1] ?? '')) {
      i++
      note = { string, fret: num()!, harmonic: c === '<' ? 'natural' : 'artificial' }
      if (body[i] === '>' || body[i] === ']') i++
    } else if (c === '(' && /\d/.test(body[i + 1] ?? '')) {
      i++
      note = { string, fret: num()!, ghost: true }
      if (body[i] === ')') i++
    } else {
      i++
      tap = false
      continue
    }
    if (slideIn) note.slide = slideIn
    if (tap) note.tap = true
    tap = false
    // Technique suffixes until the next separator.
    for (;;) {
      const s = body[i]
      if (s === 'b' || s === 'B' || s === '^') {
        i++
        const target = num()
        note.bend = target !== null && target > note.fret ? Math.min(2, Math.max(0.5, (target - note.fret) / 2)) : 1
      } else if (s === 'r' || s === 'R') {
        i++
        num()
        if (note.bend) note.release = true
      } else if (s === '~' || s === 'v') {
        i++
        note.vibrato = true
      } else if (s === 't' || s === 'T') {
        break // tapping the following fret: handled when that note is read
      } else if (s === 'h' || s === 'H' || s === 'p' || s === 'P') {
        // hammer/pull into the following fret: the next number is a new note at its own column
        note.legato = s.toLowerCase() as 'h' | 'p'
        i++
        break
      } else if ((s === '/' || s === '\\' || s === 's') && !note.slide) {
        const nextIsFret = /\d/.test(body[i + 1] ?? '')
        note.slide = nextIsFret || s === 's' ? 'to' : s === '/' ? 'outUp' : 'outDown'
        i++
        break
      } else break
    }
    out.push({ col, note })
  }
  return out
}

const GRID_TICKS = [240, 120] // 16th, then 32nd when notes are dense

/** Most frequent gap between note columns (the smallest one on ties): the bar's rhythmic unit. */
function commonGap(cols: number[]) {
  const counts = new Map<number, number>()
  for (let k = 1; k < cols.length; k++) counts.set(cols[k] - cols[k - 1], (counts.get(cols[k] - cols[k - 1]) ?? 0) + 1)
  let best = 0
  let bestCount = 0
  for (const [gap, count] of counts) if (count > bestCount || (count === bestCount && gap < best)) [best, bestCount] = [gap, count]
  return best
}

/**
 * Turns note columns inside one bar into beats. Rhythm is estimated by treating the most common
 * spacing as one unit, fitting the bar into a whole number of units, and quantizing to 16ths (32nds when dense).
 */
function buildMeasure(notes: RawNote[], start: number, end: number, ts: [number, number]): TabMeasure {
  const capacity = measureCapacity(ts)
  const cols = [...new Set(notes.map((n) => n.col))].sort((a, b) => a - b)
  const grid = GRID_TICKS.find((g) => capacity / g >= cols.length) ?? 120
  const positions: number[] = []
  if (cols.length) {
    const unit = commonGap(cols) || Math.max(1, end - cols[0])
    const lead = Math.max(0, Math.round((cols[0] - start) / unit - 0.25)) // a note right after the bar line starts it
    const span = Math.round((end - cols[0]) / unit)
    const units = Math.max(lead + span, lead + Math.ceil((cols[cols.length - 1] - cols[0]) / unit) + 1)
    const unitTicks = capacity / units
    for (const col of cols) {
      let tick = Math.round(((lead + (col - cols[0]) / unit) * unitTicks) / grid) * grid
      const prev = positions[positions.length - 1]
      if (prev !== undefined && tick <= prev) tick = prev + grid
      positions.push(Math.min(tick, capacity - grid))
    }
    // Keep positions strictly increasing even after clamping at the bar end.
    for (let k = positions.length - 2; k >= 0; k--) {
      if (positions[k] >= positions[k + 1]) positions[k] = positions[k + 1] - grid
    }
  }

  const beats: TabBeat[] = []
  const pushSpan = (ticks: number, beatNotes: TabNote[]) => {
    splitTicks(ticks).forEach((shape, k) => {
      const notes = k === 0 ? beatNotes : beatNotes.filter((n) => !n.dead).map((n) => ({ string: n.string, fret: n.fret, tie: true }))
      beats.push({ id: uid(), duration: shape.duration, ...(shape.dotted ? { dotted: true } : {}), notes })
    })
  }
  if (positions.length === 0 || positions[0] > 0) pushSpan(positions[0] ?? capacity, [])
  cols.forEach((col, i) => {
    const span = (positions[i + 1] ?? capacity) - positions[i]
    const beatNotes = notes
      .filter((n) => n.col === col)
      .map((n) => n.note)
      .sort((a, b) => a.string - b.string)
    pushSpan(span, beatNotes)
  })
  return { id: uid(), beats }
}

export function parseTextTab(text: string, strings: number, ts: [number, number]): ParseResult {
  const lines = text.replace(/\t/g, '    ').split(/\r?\n/)
  const measures: TabMeasure[] = []
  const blockStrings: number[] = []
  let noteCount = 0

  let i = 0
  while (i < lines.length) {
    if (!isTabLine(lines[i])) {
      i++
      continue
    }
    const block: string[] = []
    while (i < lines.length && isTabLine(lines[i])) block.push(lines[i++])
    blockStrings.push(block.length)

    const pmLine = lines[i - block.length - 1]
    const offset = bodyStart(block[0])
    const first = block[0].slice(offset)

    // Bar lines from the top string; "|" or ":" (repeat signs) count.
    const bars = [...first].flatMap((ch, k) => (ch === '|' || ch === ':' ? [k] : []))
    const edges = [0, ...bars, first.length].filter((v, k, a) => k === 0 || v > a[k - 1])

    const raw = block.slice(0, strings).flatMap((line, si) => scanString(line.slice(bodyStart(line)), si + 1, 0))
    if (pmLine && /^[\sPMpm.\-–—|]*$/.test(pmLine) && /P\.?M/i.test(pmLine)) {
      // Each "PM----" span mutes the notes under it (same column space as the TAB body).
      for (const span of pmLine.matchAll(/P\.?M\.?[-–—.|]*/gi)) {
        const from = span.index - offset
        const to = from + span[0].length
        for (const r of raw) if (r.col >= from && r.col < to) r.note.palmMute = true
      }
    }

    for (let k = 0; k + 1 < edges.length; k++) {
      const [a, b] = [edges[k], edges[k + 1]]
      const inBar = raw.filter((r) => r.col > a - (k === 0 ? 1 : 0) && r.col < b)
      if (b - a <= 2 && inBar.length === 0) continue // e.g. "||" or a leading "|"
      if (inBar.length === 0 && first.slice(a, b).replace(/[|:]/g, '').trim() === '') continue
      measures.push(buildMeasure(inBar, a, b, ts))
      noteCount += inBar.length
    }
  }
  return { measures, noteCount, blockStrings }
}

/** Appends parsed measures, fixing ties that now follow a different note. */
export function appendMeasures(content: TabContent, measures: TabMeasure[], replace: boolean): TabContent {
  const base = replace ? [] : content.measures
  const joined: TabContent = { ...content, measures: [...base, ...measures] }
  const first = measures[0]?.beats[0]
  if (!first) return joined
  // A tie at the start of the appended text only makes sense if the previous note matches.
  const m = base.length
  const notes = first.notes.filter((n) => !n.tie || previousNote(joined, { m, b: 0, s: n.string })?.fret === n.fret)
  const fixed = { ...measures[0], beats: [{ ...first, notes }, ...measures[0].beats.slice(1)] }
  return { ...content, measures: [...base, fixed, ...measures.slice(1)] }
}

/** Total length check used by tests and the import preview. */
export const measureTicks = (m: TabMeasure) => m.beats.reduce((t, b) => t + beatTicks(b), 0)
