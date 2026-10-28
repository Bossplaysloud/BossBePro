// Chord charts (歌詞＋和弦) stored as ChordPro-style text: chords in brackets before the syllable
// they fall on, e.g. "[Am]我們的 [F]故事". A line holding only a non-chord label in brackets is
// a section heading ("[Verse]", "[副歌]"). Lines starting with "#" are comments. Lines made of
// bars ("| G | D/F# | Cmaj7 | D11 | x2") are chord-only progressions (intros, interludes).

import { parseChord, parsePitchClass } from './chords'

export interface ChordChartContent {
  kind: 'chords'
  version: 1
  text: string
  /** Semitones the chords have been moved from the original key (−6…+6; 0 = original). */
  transpose?: number
  /** Capo fret (0 = none). Chords are written as fingered; the sound is `capo` semitones higher. */
  capo?: number
  meta?: ChartMeta
}

/** Song facts printed on many charts. The sheet's own key is the key the chords are written in. */
export interface ChartMeta {
  originalKey?: string // 原調
  maleKey?: string // 男調
  femaleKey?: string // 女調
  tempo?: number
  timeSignature?: string
}

/** Wraps a semitone count into −6…+6 (a tritone up stays +6). */
export function normalizeSteps(n: number) {
  const m = ((n % 12) + 12) % 12
  return m > 6 ? m - 12 : m
}

/** Transposes the chords and keeps count of the total shift from the original key. */
export function transposeContent(c: ChordChartContent, semitones: number): ChordChartContent {
  return { ...c, text: transposeChart(c.text, semitones), transpose: normalizeSteps((c.transpose ?? 0) + semitones) }
}

/** A capo mentioned in the text, e.g. "Capo 2", "capo: 3", "移調夾 2". */
export function detectCapo(text: string): number | null {
  const m = /(?:capo|移調夾|變調夾)\s*[:：]?\s*(\d{1,2})/i.exec(text)
  const n = m ? Number(m[1]) : NaN
  return n >= 1 && n <= 11 ? n : null
}

export function emptyChordChart(): ChordChartContent {
  return { kind: 'chords', version: 1, text: '' }
}

export function isChordChartContent(c: unknown): c is ChordChartContent {
  return !!c && typeof c === 'object' && (c as ChordChartContent).kind === 'chords' && typeof (c as ChordChartContent).text === 'string'
}

export interface Segment {
  chord?: string
  text: string
}

/** One item of a bar line: a bar of chords, or a mark between/after bars ("x2", "(回▲)"). */
export type BarItem = { type: 'bar'; chords: string[] } | { type: 'mark'; text: string }

/** One beat of a rhythm pattern: its symbols and how many underlines (beams) each has. */
export interface PatternBeat {
  symbols: { text: string; lines: number; dotted?: boolean }[]
  tuplet?: number // 3 → triplet mark
}

export type ChartLine =
  | { type: 'lyric'; segments: Segment[] }
  | { type: 'bars'; items: BarItem[] }
  | { type: 'pattern'; label: string; beats: (PatternBeat | '|')[] }
  | { type: 'section'; label: string }
  | { type: 'comment'; text: string }
  | { type: 'blank' }

const BRACKET = /\[([^\]]*)\]/g
const REPEAT = /^(?:[x×X]\s*\d+|\d+\s*[x×X])$/
const BAR_FILLER = /^(?:%|-|\.|\/)$/

/** "| [G] [D/F#] | [Em] | x2 | [C] |" → bars and marks; null if the line is not a bar line. */
export function parseBarLine(line: string): { items: BarItem[] } | null {
  const text = line.trim().replace(/([x×X])\s+(\d+)/g, '$1$2')
  if (!text.startsWith('|') && !text.startsWith(':')) return null
  const items: BarItem[] = []
  let current: string[] = []
  const close = () => {
    if (current.length) items.push({ type: 'bar', chords: current })
    current = []
  }
  for (const token of text.replace(/(\|\|?|:\|\|?|\|\|?:)/g, ' $1 ').split(/\s+/).filter(Boolean)) {
    const bare = token.replace(/^\[|\]$/g, '')
    if (/^[|:]+$/.test(token)) close()
    else if (REPEAT.test(token) || /^\(.*\)$/.test(token)) {
      close()
      items.push({ type: 'mark', text: token })
    } else if (parseChord(bare) || BAR_FILLER.test(bare)) current.push(bare)
    else return null
  }
  close()
  return items.some((i) => i.type === 'bar') ? { items } : null
}

/** Section names arrive in many shapes ("(1) [間奏1]", "【副歌】"): drop the brackets. */
export function cleanLabel(raw: string) {
  return raw.replace(/[[\]【】〔〕]/g, ' ').replace(/\s+/g, ' ').trim()
}

const PATTERN_LABEL = /^(指法|刷法|節奏|分解|伴奏|右手|彈法|picking|strum(?:ming)?|pattern|rhythm)$/i

/**
 * Rhythm pattern text: groups separated by spaces are beats; the symbols in a beat share it
 * evenly (2 → eighths, 4 → sixteenths, 3 → triplet). For uneven beats, "_" after a symbol is one
 * underline and "." a dot, e.g. "↑_↑__↓__" (eighth + two sixteenths). Symbols left unmarked in a
 * marked beat share whatever time is left. "|" separates bars. "(12)" is one symbol.
 */
export function parsePattern(text: string): (PatternBeat | '|')[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((group): PatternBeat | '|' => {
      if (/^\|+$/.test(group)) return '|'
      const parts = [...group.matchAll(/(\([^)]*\)|[^_.\s])(_*)(\.?)/g)].map((m) => ({ text: m[1], under: m[2].length, dotted: m[3] === '.', marked: m[2].length > 0 || m[3] === '.' }))
      const n = parts.length
      const marked = parts.filter((p) => p.marked)
      if (!marked.length) {
        const even = n >= 8 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0
        return { symbols: parts.map((p) => ({ text: p.text, lines: even })), ...(n === 3 || n === 6 ? { tuplet: n } : {}) }
      }
      // Fractions of a beat: a symbol with k underlines lasts 1/2^k, a dot adds half.
      const length = (p: { under: number; dotted: boolean }) => (p.dotted ? 1.5 : 1) / 2 ** p.under
      const unmarked = parts.filter((p) => !p.marked)
      const left = 1 - marked.reduce((t, p) => t + length(p), 0)
      if (unmarked.length && left > 0) {
        // Share the rest of the beat among unmarked symbols when that gives a plain note value.
        const lines = Math.log2(unmarked.length / left)
        if (Math.abs(lines - Math.round(lines)) < 1e-6 && Math.round(lines) >= 0) for (const p of unmarked) p.under = Math.round(lines)
      }
      return { symbols: parts.map((p) => ({ text: p.text, lines: p.under, ...(p.dotted ? { dotted: true } : {}) })) }
    })
}

/** Writes beats back as pattern text; even beats stay plain, uneven ones get "_" / "." marks. */
export function formatPattern(beats: { symbols: { text: string; duration: number; dotted?: boolean }[] }[], barsAfter: boolean[] = []) {
  return beats
    .map((beat, i) => {
      const lines = beat.symbols.map((s) => Math.max(0, Math.round(Math.log2(s.duration / 4))))
      // Equal values are written plain: the reader splits the beat evenly (3 or 6 → tuplet).
      const plain = beat.symbols.every((s) => !s.dotted && s.duration === beat.symbols[0].duration)
      const group = beat.symbols.map((s, k) => (plain ? s.text : `${s.text}${'_'.repeat(lines[k])}${s.dotted ? '.' : ''}`)).join('')
      return barsAfter[i] && i < beats.length - 1 ? `${group} |` : group
    })
    .join(' ')
}

/** True when "[" and "]" pair up without closing before opening. */
function balanced(text: string) {
  let depth = 0
  for (const ch of text) {
    if (ch === '[') depth++
    else if (ch === ']' && --depth < 0) return false
  }
  return depth === 0
}

export function parseChart(text: string): ChartLine[] {
  return text.split(/\r?\n/).flatMap((raw): ChartLine[] => {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) return [{ type: 'blank' }]
    // "[指法] T1 21 T1 21" (or the older "# 指法：…") is a rhythm pattern.
    const pattern = /^\s*(?:\[([^\]]+)\]|#\s*([^：:]+)[：:])\s*(.+)$/.exec(line)
    const patternLabel = pattern && (pattern[1] ?? pattern[2])?.trim()
    if (pattern && patternLabel && PATTERN_LABEL.test(patternLabel)) return [{ type: 'pattern', label: patternLabel, beats: parsePattern(pattern[3]) }]
    if (line.trim().startsWith('#')) return [{ type: 'comment', text: line.trim().slice(1).trim() }]
    const bars = parseBarLine(line)
    if (bars) return [{ type: 'bars', ...bars }]
    // "[前奏] | G | D/F# |": a heading followed by bars on the same line.
    const labelled = /^\s*\[([^\]]+)\]\s*(\|.*)$/.exec(line)
    if (labelled && !parseChord(labelled[1])) {
      const rest = parseBarLine(labelled[2])
      if (rest) return [{ type: 'section', label: cleanLabel(labelled[1]) }, { type: 'bars', ...rest }]
    }
    // A heading: the whole line in brackets, tolerating balanced brackets inside ("[(1) [間奏1]]").
    const trimmed = line.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && balanced(trimmed.slice(1, -1))) {
      const inner = cleanLabel(trimmed.slice(1, -1))
      const allChords = trimmed.slice(1, -1).split(/\]\s*\[/).every((x) => parseChord(x.trim()))
      if (inner && !allChords) return [{ type: 'section', label: inner }]
    }
    const segments: Segment[] = []
    let last = 0
    let chord: string | undefined
    for (const m of line.matchAll(BRACKET)) {
      if (m.index > last || chord) segments.push({ ...(chord ? { chord } : {}), text: line.slice(last, m.index) })
      chord = m[1].trim()
      last = m.index + m[0].length
    }
    segments.push({ ...(chord ? { chord } : {}), text: line.slice(last) })
    return [{ type: 'lyric', segments: segments.filter((s, i) => s.chord || s.text || i === 0) }]
  })
}

/** Chord names in order of first appearance. */
export function chartChords(text: string): string[] {
  const out: string[] = []
  for (const line of parseChart(text)) {
    const names =
      line.type === 'lyric'
        ? line.segments.flatMap((s) => (s.chord ? [s.chord] : []))
        : line.type === 'bars'
          ? line.items.flatMap((i) => (i.type === 'bar' ? i.chords : []))
          : []
    for (const c of names) if (parseChord(c) && !out.includes(c)) out.push(c)
  }
  return out
}

// ---------- transposing ----------

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

export function transposeChordName(name: string, semitones: number, preferFlats: boolean): string {
  const m = /^([A-G][#♯b♭]?)(.*?)(?:\/([A-G][#♯b♭]?))?$/.exec(name.trim())
  if (!m || !parseChord(name)) return name
  const names = preferFlats ? FLATS : SHARPS
  const shift = (n: string) => names[(((parsePitchClass(n) ?? 0) + semitones) % 12 + 12) % 12]
  return `${shift(m[1])}${m[2]}${m[3] ? `/${shift(m[3])}` : ''}`
}

/** Transposes every chord in the text; spelling follows the direction (flats down, sharps up). */
export function transposeChart(text: string, semitones: number): string {
  const preferFlats = semitones < 0
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*\[([^\]]+)\]\s*$/.test(line) && !parseChord(line.trim().slice(1, -1))) return line // section heading
      const bracketed = line.replace(BRACKET, (all, inner: string) => (parseChord(inner) ? `[${transposeChordName(inner, semitones, preferFlats)}]` : all))
      // Bar lines carry bare chord names.
      const barStart = bracketed.search(/\|/)
      if (barStart >= 0 && parseBarLine(bracketed.slice(barStart))) {
        // (bracketed chords were handled above; bare names are transposed here)
        return bracketed.slice(0, barStart) + bracketed.slice(barStart).replace(/(^|[\s|:])([^\s|:[\]]+)(?=$|[\s|:])/g, (all, pre: string, tok: string) => (parseChord(tok) ? pre + transposeChordName(tok, semitones, preferFlats) : all))
      }
      return bracketed
    })
    .join('\n')
}

// ---------- "chords above lyrics" text ----------

/** Display columns of a character: CJK and full-width characters take two columns in monospace text. */
const width = (ch: string) => (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1)

function isChordLine(line: string) {
  const tokens = line.trim().split(/\s+/).filter(Boolean)
  return tokens.length > 0 && tokens.every((t) => parseChord(t.replace(/[()|]/g, '')) || /^[|/\-.x%]+$/.test(t))
}

/**
 * Converts the common web format, with chord names on the line above the lyrics, into inline
 * [Chord] markers placed by column. Lines already in bracket format are left alone.
 */
export function chordsAboveToInline(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next0 = lines[i + 1]
    const lyricBelow = next0 !== undefined && !!next0.trim() && !isChordLine(next0) && !parseBarLine(next0)
    // Bar lines with nothing under them are progressions, not chords placed over lyrics.
    if (!isChordLine(line) || line.includes('[') || (parseBarLine(line) && !lyricBelow)) {
      out.push(line)
      continue
    }
    const chords = [...line.matchAll(/\S+/g)].filter((m) => parseChord(m[0].replace(/[()|]/g, ''))).map((m) => ({ col: m.index, name: m[0].replace(/[()|]/g, '') }))
    const next = lines[i + 1]
    if (next === undefined || !next.trim() || isChordLine(next)) {
      out.push(line.includes('|') && parseBarLine(line) ? formatBars(parseBarLine(line)!) : chords.map((c) => `[${c.name}]`).join(' '))
      continue
    }
    // Map each chord's column onto a character index of the lyric line.
    let result = ''
    let col = 0
    let k = 0
    for (const ch of next) {
      // A chord over either column of a full-width character belongs to that character.
      while (k < chords.length && chords[k].col < col + width(ch)) result += `[${chords[k++].name}]`
      result += ch
      col += width(ch)
    }
    while (k < chords.length) result += `${' '.repeat(Math.max(0, chords[k].col - col) ? 1 : 0)}[${chords[k++].name}]`
    out.push(result)
    i++
  }
  return out.join('\n')
}

/** "| [G] | [D/F#] | [Cmaj7] | [D11] | x2 | [C] |" */
export function formatBars({ items }: { items: BarItem[] }) {
  let out = '|'
  items.forEach((item, i) => {
    if (item.type === 'bar') out += ` ${item.chords.map((c) => (parseChord(c) ? `[${c}]` : c)).join(' ')} |`
    else out += ` ${item.text}${items[i + 1]?.type === 'bar' ? ' |' : ''}`
  })
  return out
}

// ---------- building text from a bar-by-bar transcription ----------

export interface ChartBarSegment {
  chord: string | null
  lyric: string
  x?: number | null // chord position across the image, 0–1000
}

export interface ChartSourceLine {
  bars: { segments: ChartBarSegment[] }[]
  repeat: string | null // "x2"
  note: string | null // e.g. "(回▲)"
  lyricStart?: number | null // lyric extent across the image, 0–1000
  lyricEnd?: number | null
  /** Set when the chord row and lyric row were joined: the chords are always placed by position. */
  joined?: boolean
}

/** Beat fillers ("- -") copied from the chord line into the lyrics. */
export function dropDashFillers(lyric: string) {
  return lyric.replace(/([\u3400-\u9fff\uf900-\ufaff])-+/g, '$1').replace(/(^|\s)-+(?=\s|$)/g, '$1')
}

/** Width of a lyric character in em: CJK and full-width characters are square, others narrower. */
const lyricWidth = (ch: string) => (width(ch) === 2 || /[★☆▲△●○◆◇■□※]/.test(ch) ? 1 : 0.55)

/**
 * Checks where each chord sits in the lyric line against its printed position. When the
 * transcription put chords in the wrong place (stacked before the words, or after them), the
 * chords are placed over the character found at their position instead.
 */
export function alignByPosition(line: ChartSourceLine, force = false): ChartBarSegment[] {
  const segs = line.bars.flatMap((b) => b.segments).map((s) => ({ ...s, lyric: dropDashFillers(s.lyric) }))
  const { lyricStart: start, lyricEnd: end } = line
  const chords = segs.filter((s) => s.chord)
  if (!chords.length || start == null || end == null || end - start < 30 || chords.some((s) => s.x == null)) return segs
  const chars = [...segs.map((s) => s.lyric).join('').replace(/\s+$/, '')]
  if (chars.length < 2) return segs
  const lefts: number[] = []
  let total = 0
  for (const ch of chars) {
    lefts.push(total)
    total += lyricWidth(ch)
  }
  // Character index under each chord's position (chords right of the words go after the last one).
  const predicted = chords.map((s) => {
    const u = ((s.x! - start) / (end - start)) * total
    if (u >= total - 0.1) return chars.length
    let i = 0
    while (i + 1 < chars.length && lefts[i + 1] <= u + 0.4) i++
    return i
  })
  for (let k = 1; k < predicted.length; k++) predicted[k] = Math.max(predicted[k], predicted[k - 1])
  // Where the transcription put each chord.
  const actual: number[] = []
  let at = 0
  for (const s of segs) {
    if (s.chord) actual.push(at)
    at += [...s.lyric].length
  }
  const unitAt = (i: number) => (i >= chars.length ? total : lefts[i])
  const off = Math.max(...predicted.map((p, k) => Math.abs(unitAt(p) - unitAt(actual[k]))))
  if (!force && off < Math.max(2.5, total * 0.15)) return segs
  const out: ChartBarSegment[] = []
  if (predicted[0] > 0) out.push({ chord: null, lyric: chars.slice(0, predicted[0]).join('') })
  chords.forEach((s, k) => out.push({ chord: s.chord, lyric: chars.slice(predicted[k], predicted[k + 1] ?? chars.length).join('') }))
  return out
}

export interface ChartSourceSection {
  label: string | null // 前奏 / 主歌 / 副歌 / 間奏1 …
  lines: ChartSourceLine[]
}

const lineHasLyric = (l: ChartSourceLine) => l.bars.some((b) => b.segments.some((s) => s.lyric.trim()))
const lineHasChord = (l: ChartSourceLine) => l.bars.some((b) => b.segments.some((s) => s.chord))

/**
 * A section name at the start of lyric text, where some transcriptions put it:
 * "[間奏2] …", "(2) [間奏3]", "間奏2 …". Returns the label and the text after it.
 */
export function leadingSectionName(text: string): { label: string; rest: string } | null {
  let rest = text
  const parts: string[] = []
  for (;;) {
    const m = /^\s*(\(\d+\)|\[([^[\]]*)\]|【([^】]*)】|(前奏|主歌|副歌|間奏|尾奏|橋段|導歌|過門|intro|verse|chorus|bridge|interlude|outro|pre-?chorus|ending)\s*\d*(?=[\s[]|$))/i.exec(rest)
    if (!m) break
    const inner = (m[2] ?? m[3])?.trim()
    // Bracketed names must read as names (Chinese text, a section word or an ending number), not chords.
    if (inner !== undefined && (!inner || parseChord(inner) || !/[\u3400-\u9fff]|^\(\d+\)|^(?:intro|verse|chorus|bridge|interlude|outro|pre-?chorus|ending)\b/i.test(inner))) break
    parts.push(inner ?? m[1])
    rest = rest.slice(m[0].length)
  }
  const label = cleanLabel(parts.join(' '))
  return label ? { label, rest: rest.replace(/^\s+/, '') } : null
}

const ENDING_ONLY = /^\(\d+\)$/

/** Section names found inside lyrics become sections; an ending number "(1)" joins the name after it. */
export function liftSectionNames(sections: ChartSourceSection[]): ChartSourceSection[] {
  const out: ChartSourceSection[] = []
  for (const section of sections) {
    let current: ChartSourceSection = { label: section.label, lines: [] }
    out.push(current)
    for (const line of section.lines) {
      const first = line.bars[0]?.segments[0]
      const lifted = first && !first.chord ? leadingSectionName(first.lyric) : null
      if (!lifted) {
        current.lines.push(line)
        continue
      }
      const rest: ChartSourceLine = { ...line, bars: line.bars.map((b, i) => ({ segments: b.segments.map((g, k) => (i === 0 && k === 0 ? { ...g, lyric: lifted.rest } : g)) })) }
      current = { label: lifted.label, lines: [] }
      out.push(current)
      if (lineHasLyric(rest) || lineHasChord(rest) || rest.repeat?.trim() || rest.note?.trim()) current.lines.push(rest)
    }
  }
  const merged: ChartSourceSection[] = []
  for (let i = 0; i < out.length; i++) {
    const s = out[i]
    const label = s.label ? cleanLabel(s.label) : ''
    if (!s.lines.length && ENDING_ONLY.test(label) && out[i + 1]?.label?.trim()) {
      out[i + 1] = { ...out[i + 1], label: `${label} ${cleanLabel(out[i + 1].label!)}` }
      continue
    }
    if (!s.lines.length && !label) continue
    merged.push(s)
  }
  return merged
}

/** Chords of a bar line placed over a lyric line printed under it, spread evenly over each bar. */
export function joinBarsWithLyric(items: BarItem[], lyric: string): string {
  const bars = items.flatMap((i) => (i.type === 'bar' ? [i.chords.filter((c) => parseChord(c))] : []))
  const n = bars.length
  const segments: ChartBarSegment[] = [{ chord: null, lyric, x: null }, ...bars.flatMap((chords, bi) => chords.map((c, k) => ({ chord: c, lyric: '', x: Math.round((1000 * (bi + k / chords.length)) / n) })))]
  return alignByPosition({ bars: [{ segments }], repeat: null, note: null, lyricStart: 0, lyricEnd: 1000 }, true)
    .map((g) => `${g.chord ? `[${g.chord}]` : ''}${g.lyric}`)
    .join('')
}

/**
 * Some transcriptions return a chord row and the lyric row printed under it as two lines (or even
 * two groups): chords with no words, then words with no chords. Those are joined back into one
 * line, each chord placed by its printed position, or spread evenly over its bar when no position is known.
 */
export function joinSplitLines(sections: ChartSourceSection[]): ChartSourceSection[] {
  const out: ChartSourceSection[] = []
  let prev: ChartSourceLine | null = null // last line written, if it is chords only
  for (const section of sections) {
    const lines: ChartSourceLine[] = []
    section.lines.forEach((line, i) => {
      const startsGroup = i === 0 && !!section.label?.trim()
      const words = lineHasLyric(line) && !lineHasChord(line)
      if (prev && words && !startsGroup) {
        const host = prev
        const lyric = line.bars.flatMap((b) => b.segments.map((s) => s.lyric)).join('')
        const known = host.bars.every((b) => b.segments.every((s) => !s.chord || s.x != null)) && line.lyricStart != null && line.lyricEnd != null && line.lyricEnd - line.lyricStart >= 30
        const n = host.bars.length
        const chords = host.bars.flatMap((b, bi) => {
          const inBar = b.segments.filter((s) => s.chord)
          return inBar.map((s, k) => ({ chord: s.chord, lyric: '', x: known ? s.x : Math.round((1000 * (bi + k / inBar.length)) / n) }))
        })
        host.bars = [{ segments: [{ chord: null, lyric, x: null }, ...chords] }]
        host.joined = true
        host.lyricStart = known ? line.lyricStart : 0
        host.lyricEnd = known ? line.lyricEnd : 1000
        host.note = [host.note, line.note].filter((x) => x?.trim()).join(' ') || null
        host.repeat = host.repeat ?? line.repeat
        prev = null
        return
      }
      const copy = { ...line, bars: line.bars.map((b) => ({ segments: b.segments.map((s) => ({ ...s })) })) }
      lines.push(copy)
      prev = lineHasChord(copy) && !lineHasLyric(copy) && !copy.repeat ? copy : null
    })
    if (lines.length || section.label?.trim()) out.push({ ...section, lines })
  }
  return out
}

/**
 * Builds chart text: lyric lines get [Chord] markers before the syllable each chord starts on
 * (bar by bar, so a misread position can only shift within one bar); chord-only lines become bar lines.
 */
export function chartTextFromSections(sections: ChartSourceSection[], fixChord: (c: string) => string | null): string {
  const out: string[] = []
  for (const section of joinSplitLines(liftSectionNames(sections))) {
    if (out.length) out.push('')
    if (section.label && cleanLabel(section.label)) out.push(`[${cleanLabel(section.label)}]`)
    for (const line of section.lines) {
      const tail = [line.repeat, line.note].filter((x) => x?.trim()).join(' ')
      const hasLyric = line.bars.some((b) => b.segments.some((s) => s.lyric.trim()))
      if (!hasLyric) {
        const items: BarItem[] = line.bars
          .map((b) => b.segments.flatMap((s) => (s.chord && fixChord(s.chord) ? [fixChord(s.chord)!] : [])))
          .filter((b) => b.length)
          .map((chords) => ({ type: 'bar' as const, chords }))
        for (const mark of [line.repeat, line.note]) if (mark?.trim()) items.push({ type: 'mark', text: mark.trim().replace(/([x×X])\s+(\d+)/, '$1$2') })
        if (items.some((i) => i.type === 'bar')) out.push(formatBars({ items }))
        else if (tail) out.push(tail)
        continue
      }
      const text = alignByPosition(line, line.joined)
        .map((s) => `${s.chord && fixChord(s.chord) ? `[${fixChord(s.chord)}]` : ''}${s.lyric}`)
        .join('')
      out.push(tail ? `${text.replace(/\s+$/, '')}  ${tail}` : text.replace(/\s+$/, ''))
    }
  }
  return out.join('\n')
}
