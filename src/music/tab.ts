// TAB content model. Strings are numbered 1..N with 1 = highest-pitched string (top TAB line),
// the same convention as Sheet.tuning and alphaTex. Measure/beat/rhythm handling lives in rhythm.ts.

import { chordAt, emptyMeasure, inSpan, stepBeat, updateBeat, type Beat, type BeatSpan, type Content, type Cursor, type Measure } from './rhythm'

export * from './rhythm'

export type Legato = 'h' | 'p' // hammer-on / pull-off into the next note on the string
export type Slide = 'to' | 'inBelow' | 'inAbove' | 'outDown' | 'outUp'
export type Harmonic = 'natural' | 'artificial'

export interface TabNote {
  string: number
  fret: number
  dead?: boolean // muted "x" note; fret is ignored
  tie?: boolean // continues the previous note on this string (same fret)
  legato?: Legato
  slide?: Slide
  bend?: number // in steps: 0.5 = half step, 1 = full, up to 2
  release?: boolean // bend and release back
  harmonic?: Harmonic
  palmMute?: boolean
  vibrato?: boolean
  letRing?: boolean
  ghost?: boolean
  tap?: boolean // tapped with the picking hand ("T" over the note)
}

export type NoteFlag = 'palmMute' | 'vibrato' | 'letRing' | 'ghost' | 'release' | 'tap'

export type TabBeat = Beat<TabNote>
export type TabMeasure = Measure<TabNote>
export interface TabContent extends Content<TabNote> {
  kind: 'tab'
}

export const BEND_STEPS = [0.5, 1, 1.5, 2]

/** Absolute fret limit; each sheet sets its own (12–36). */
export const MAX_FRET = 36
export const MIN_FRETS = 12

export function emptyTab(ts: [number, number]): TabContent {
  return { kind: 'tab', version: 1, measures: [emptyMeasure(ts), emptyMeasure(ts)] }
}

export function isTabContent(c: unknown): c is TabContent {
  return !!c && typeof c === 'object' && (c as TabContent).kind === 'tab' && Array.isArray((c as TabContent).measures)
}

/**
 * Sets (or with `fret === null` clears) the note on one string of a beat. A string holds at most
 * one note per beat. Re-entering a fret keeps the note's techniques; entering x makes it a plain dead note.
 */
export function setNote(c: TabContent, { m, b, s }: Cursor, fret: number | 'x' | null, maxFret = MAX_FRET): TabContent {
  return updateBeat(c, m, b, (beat) => {
    const others = beat.notes.filter((n) => n.string !== s)
    if (fret === null) return { ...beat, notes: others }
    const prev = beat.notes.find((n) => n.string === s)
    const note: TabNote =
      fret === 'x'
        ? { string: s, fret: 0, dead: true }
        : { ...(prev && !prev.dead ? prev : {}), string: s, fret: Math.max(0, Math.min(maxFret, fret)), tie: undefined }
    return { ...beat, notes: [...others, clean(note)].sort((x, y) => x.string - y.string) }
  })
}

/** Drops undefined/false fields so stored notes stay compact. */
function clean(n: TabNote): TabNote {
  const out = { ...n } as Record<string, unknown>
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === false) delete out[k]
  return out as unknown as TabNote
}

/** Applies a change to the note under the cursor. Returns the content unchanged if there is no (non-dead) note. */
export function updateNote(c: TabContent, { m, b, s }: Cursor, fn: (n: TabNote) => TabNote): TabContent {
  const n = getNote(c, { m, b, s })
  if (!n || n.dead) return c
  return updateBeat(c, m, b, (beat) => ({ ...beat, notes: beat.notes.map((x) => (x.string === s ? clean(fn(x)) : x)) }))
}

export const toggleFlag = (c: TabContent, cur: Cursor, flag: NoteFlag) => updateNote(c, cur, (n) => ({ ...n, [flag]: !n[flag] }))

export const toggleLegato = (c: TabContent, cur: Cursor, kind: Legato) =>
  updateNote(c, cur, (n) => ({ ...n, legato: n.legato === kind ? undefined : kind }))

/** Toggles a slide kind; the "in"/"out" kinds cycle through their two directions. */
export function cycleSlide(c: TabContent, cur: Cursor, group: 'to' | 'in' | 'out'): TabContent {
  const order: Record<typeof group, (Slide | undefined)[]> = {
    to: ['to', undefined],
    in: ['inBelow', 'inAbove', undefined],
    out: ['outDown', 'outUp', undefined],
  }
  return updateNote(c, cur, (n) => {
    const seq = order[group]
    const i = seq.indexOf(n.slide)
    return { ...n, slide: i === -1 ? seq[0] : seq[(i + 1) % seq.length] }
  })
}

export const cycleBend = (c: TabContent, cur: Cursor) =>
  updateNote(c, cur, (n) => {
    const i = n.bend ? BEND_STEPS.indexOf(n.bend) : -1
    const bend = BEND_STEPS[i + 1]
    return { ...n, bend, release: bend ? n.release : undefined }
  })

export const toggleHarmonic = (c: TabContent, cur: Cursor, kind: Harmonic) =>
  updateNote(c, cur, (n) => ({ ...n, harmonic: n.harmonic === kind ? undefined : kind }))

/** Toggles a tie from the previous note on this string (the tied note repeats its fret). */
export function toggleTie(c: TabContent, cur: Cursor): TabContent {
  const existing = getNote(c, cur)
  if (existing?.tie) return setNote(c, cur, null)
  const prev = previousNote(c, cur)
  if (!prev || prev.dead) return c
  return updateBeat(c, cur.m, cur.b, (beat) => ({
    ...beat,
    notes: [...beat.notes.filter((n) => n.string !== cur.s), { string: cur.s, fret: prev.fret, tie: true }].sort((x, y) => x.string - y.string),
  }))
}

/** Previous beat's note on the same string, crossing measure boundaries. */
export function previousNote(c: TabContent, cur: Cursor): TabNote | undefined {
  const prev = stepBeat(c, cur, -1)
  return prev ? getNote(c, prev) : undefined
}

export function getNote(c: TabContent, { m, b, s }: Cursor): TabNote | undefined {
  return c.measures[m]?.beats[b]?.notes.find((n) => n.string === s)
}

/** Replaces the beat's notes with a chord shape (fret per string, string 1 first; null = not played). */
export function applyShape(c: TabContent, m: number, b: number, frets: (number | null)[]): TabContent {
  return updateBeat(c, m, b, (beat) => ({
    ...beat,
    notes: frets.flatMap((f, i) => (f === null ? [] : [{ string: i + 1, fret: f }])),
  }))
}

// ---------- analysis ----------

export interface FretUse {
  string: number
  fret: number
  count: number
  chord?: string // chord in effect where this position is first played
}

/** Fret positions used in measures [from, to), aggregated. Dead notes, tie continuations and strings beyond `strings` are skipped. */
export function fretsUsed(c: TabContent, from: number, to: number, strings: number, span?: BeatSpan | null): FretUse[] {
  const map = new Map<string, FretUse>()
  let chord = from > 0 ? chordAt(c, from - 1, Infinity) : undefined
  for (const [i, measure] of c.measures.slice(from, to).entries()) {
    for (const [bi, beat] of measure.beats.entries()) {
      chord = beat.chord ?? chord
      // With a custom span, only the beats inside it count (the chord still carries through).
      if (!inSpan(span, from + i, bi)) continue
      for (const n of beat.notes) {
        if (n.dead || n.tie || n.string > strings) continue
        const key = `${n.string}:${n.fret}`
        const u = map.get(key)
        if (u) u.count++
        else map.set(key, { string: n.string, fret: n.fret, count: 1, ...(chord ? { chord } : {}) })
      }
    }
  }
  return [...map.values()]
}
