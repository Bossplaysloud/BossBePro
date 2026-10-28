// Checks on a transcribed measure before it becomes BePro content: columns split in two,
// incomplete tuplets, and measures whose durations do not add up to the time signature.

import { TUPLETS } from '../music/rhythm'
import { tupletOf, tupletRatio, type RecognizedBeat, type RecognizedMeasure } from './schema'

/** Length in 32nds as written (before the tuplet ratio). */
const written = (b: RecognizedBeat) => (32 / Number(b.duration)) * (b.dotted ? 1.5 : 1)
/** Length in 32nds as played (grace notes take none). */
const played = (b: RecognizedBeat) => (b.grace ? 0 : written(b) * tupletRatio(tupletOf(b)))

export const measureLength = (ts: [number, number]) => ts[0] * (32 / ts[1])

/** Beats at (almost) the same position on different strings are one column read as two. */
export function mergeColumns(beats: RecognizedBeat[]): { beats: RecognizedBeat[]; merged: number } {
  const out: RecognizedBeat[] = []
  let merged = 0
  for (const b of beats) {
    const prev = out[out.length - 1]
    const strings = new Set(prev?.tab.map((n) => n.string))
    if (prev && prev.x != null && b.x != null && Math.abs(b.x - prev.x) <= 6 && prev.tab.length && b.tab.length && b.tab.every((n) => !strings.has(n.string))) {
      out[out.length - 1] = { ...prev, tab: [...prev.tab, ...b.tab], chord: prev.chord ?? b.chord, lyric: prev.lyric ?? b.lyric }
      merged++
    } else out.push(b)
  }
  return { beats: out, merged }
}

/**
 * A run of beats with the same tuplet number must fill whole groups (three triplet eighths, six
 * sextuplet sixteenths …, so the run plays a whole number of 32nds); otherwise its marks are dropped.
 * Numbers the editor has no tuplet for are dropped as well.
 */
export function fixTuplets(beats: RecognizedBeat[]): { beats: RecognizedBeat[]; fixed: number } {
  // The older triplet flag becomes a tuplet number.
  const out = beats.map(({ triplet: _old, ...b }) => ({ ...b, tuplet: tupletOf({ ...b, triplet: _old }) }))
  let fixed = 0
  for (let i = 0; i < out.length; ) {
    const n = out[i].tuplet
    if (!n) {
      i++
      continue
    }
    let j = i
    let sum = 0
    while (j < out.length && out[j].tuplet === n) sum += written(out[j++])
    const len = sum * tupletRatio(n)
    if (!(TUPLETS as number[]).includes(n) || Math.abs(len - Math.round(len)) > 1e-6) {
      for (let k = i; k < j; k++) out[k].tuplet = 0
      fixed++
    }
    i = j
  }
  return { beats: out, fixed }
}

/** Note values a single beat can take, in 32nds: plain and dotted. */
const VALUES: { len: number; duration: RecognizedBeat['duration']; dotted: boolean }[] = [
  { len: 1, duration: '32', dotted: false },
  { len: 2, duration: '16', dotted: false },
  { len: 3, duration: '16', dotted: true },
  { len: 4, duration: '8', dotted: false },
  { len: 6, duration: '8', dotted: true },
  { len: 8, duration: '4', dotted: false },
  { len: 12, duration: '4', dotted: true },
  { len: 16, duration: '2', dotted: false },
  { len: 24, duration: '2', dotted: true },
  { len: 32, duration: '1', dotted: false },
  { len: 48, duration: '1', dotted: true },
]

/**
 * Gives the beats of a measure new durations from the space each column takes up, so that they
 * add up to `total` (in 32nds). Needs every beat's position; returns null without them.
 */
export function reflowBySpacing(m: RecognizedMeasure, total: number): RecognizedBeat[] | null {
  const xs = m.beats.map((b) => b.x)
  if (!m.beats.length || xs.some((x) => x == null)) return null
  const pos = xs as number[]
  for (let i = 1; i < pos.length; i++) if (pos[i] < pos[i - 1]) return null
  const gaps = pos.slice(1).map((x, i) => x - pos[i])
  const typical = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 1
  const end = m.end != null && m.end > pos[pos.length - 1] ? m.end : pos[pos.length - 1] + typical
  const spans = pos.map((x, i) => Math.max(1, (pos[i + 1] ?? end) - x))
  // The smallest value used: sixteenths, or 32nds when there are many beats.
  const unit = m.beats.length > total / 2 ? 1 : 2
  const units = total / unit
  if (m.beats.length > units) return null
  const sum = spans.reduce((a, b) => a + b, 0)
  const allowed = VALUES.filter((v) => v.len % unit === 0 && v.len <= total).map((v) => v.len / unit)
  const nearest = (u: number) => allowed.reduce((best, v) => (Math.abs(v - u) < Math.abs(best - u) ? v : best), allowed[0])
  const raw = spans.map((s) => (s / sum) * units)
  const lens = raw.map(nearest)
  // Nudge the beats that were rounded the most until the measure is full.
  for (let guard = 0; guard < 200; guard++) {
    const diff = units - lens.reduce((a, b) => a + b, 0)
    if (!diff) break
    let best = -1
    let bestScore = Infinity
    lens.forEach((l, i) => {
      const next = diff > 0 ? allowed.find((v) => v > l) : [...allowed].reverse().find((v) => v < l)
      if (next === undefined || Math.abs(next - l) > Math.abs(diff)) return
      const score = Math.abs(next - raw[i]) - Math.abs(l - raw[i])
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    })
    if (best < 0) return null
    lens[best] = diff > 0 ? allowed.find((v) => v > lens[best])! : [...allowed].reverse().find((v) => v < lens[best])!
  }
  if (lens.reduce((a, b) => a + b, 0) !== units) return null
  return m.beats.map((b, i) => {
    const v = VALUES.find((x) => x.len === lens[i] * unit)!
    return { ...b, duration: v.duration, dotted: v.dotted, tuplet: 0 }
  })
}

export interface MeasureCheck {
  measures: RecognizedMeasure[]
  merged: number
  tuplets: number
  /** 1-based measure numbers whose rhythm was rebuilt from spacing. */
  reflowed: number[]
  /** 1-based measure numbers that are still too long or too short. */
  wrong: number[]
}

/** Runs the checks over every measure; `tsAt` gives the time signature in force at a measure. */
export function checkMeasures(measures: RecognizedMeasure[], tsAt: (index: number) => [number, number], tabColumns: boolean): MeasureCheck {
  const result: MeasureCheck = { measures: [], merged: 0, tuplets: 0, reflowed: [], wrong: [] }
  // A pickup: the first measure is short and the last one makes up the rest (or is full while the
  // first is at most half a measure). Other short first or last measures were misread.
  const lengthOf = (i: number) => fixTuplets(measures[i]?.beats ?? []).beats.reduce((a, b) => a + played(b), 0)
  const n = measures.length
  const firstHave = n ? lengthOf(0) : 0
  const lastHave = n > 1 ? lengthOf(n - 1) : 0
  const firstTotal = n ? measureLength(tsAt(0)) : 0
  const lastTotal = n > 1 ? measureLength(tsAt(n - 1)) : 0
  const pickup =
    n > 1 &&
    firstHave > 0 &&
    firstHave < firstTotal &&
    (Math.abs(firstHave + lastHave - firstTotal) < 1e-6 || (Math.abs(lastHave - lastTotal) < 1e-6 && firstHave <= firstTotal / 2))
  measures.forEach((m, i) => {
    let beats = m.beats
    if (tabColumns) {
      const r = mergeColumns(beats)
      beats = r.beats
      result.merged += r.merged
    }
    const t = fixTuplets(beats)
    beats = t.beats
    result.tuplets += t.fixed
    const total = measureLength(tsAt(i))
    const have = beats.reduce((a, b) => a + played(b), 0)
    const edge = pickup && (i === 0 || i === n - 1) && have < total
    if (beats.length && Math.abs(have - total) > 1e-6 && !edge) {
      const reflowed = reflowBySpacing({ ...m, beats }, total)
      if (reflowed) {
        beats = reflowed
        result.reflowed.push(i + 1)
      } else result.wrong.push(i + 1)
    }
    result.measures.push({ ...m, beats })
  })
  return result
}
