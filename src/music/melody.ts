// Melody content shared by standard notation (五線譜) and numbered notation (簡譜).
// Notes store the sounding pitch as MIDI; numbered notation shows it relative to the key's "1".

import { keyTonic } from './chords'
import { emptyMeasure, stepBeat, updateBeat, type BaseNote, type Beat, type Content, type Cursor, type Measure } from './rhythm'

export type Spelling = 'sharp' | 'flat'

export interface MelodyNote extends BaseNote {
  midi: number
  /** How a black-key pitch is written (F♯ vs G♭); defaults from the key. */
  spelling?: Spelling
  /** Classical guitar: the string to play it on (circled number, 1 = highest). */
  string?: number
  /** Classical guitar: left-hand finger (1–4, 0 = open string). */
  finger?: number
}

export type MelodyBeat = Beat<MelodyNote>
export type MelodyMeasure = Measure<MelodyNote>
export interface MelodyContent extends Content<MelodyNote> {
  kind: 'melody'
}

export function emptyMelody(ts: [number, number]): MelodyContent {
  return { kind: 'melody', version: 1, measures: [emptyMeasure(ts), emptyMeasure(ts)] }
}

export function isMelodyContent(c: unknown): c is MelodyContent {
  return !!c && typeof c === 'object' && (c as MelodyContent).kind === 'melody' && Array.isArray((c as MelodyContent).measures)
}

// ---------- keys & spelling ----------

const FLAT_KEYS = new Set([5, 10, 3, 8, 1, 6]) // F Bb Eb Ab Db Gb (as the pitch class of "1")
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
/** Major key names used for key signatures (alphaTex `\ks`), by pitch class of "1". */
export const KEY_SIGNATURE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export function defaultSpelling(key: string): Spelling {
  return FLAT_KEYS.has(keyTonic(key)) ? 'flat' : 'sharp'
}

const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)

export function spelledName(midi: number, spelling: Spelling, withOctave = true) {
  const pc = ((midi % 12) + 12) % 12
  const name = (spelling === 'flat' ? FLAT_NAMES : SHARP_NAMES)[pc]
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name
}

/** alphaTex pitch, e.g. "f#4" / "bb3". */
export function texPitch(midi: number, spelling: Spelling) {
  return spelledName(midi, spelling).replace('♯', '#').replace('♭', 'b').toLowerCase()
}

/**
 * The MIDI note written as plain "1" (no octave dots) for an instrument: the key's tonic just
 * below the middle of the instrument's open-string range.
 */
export function numberedBase(tuning: number[], key: string) {
  const tonic = keyTonic(key)
  const mid = Math.floor((Math.min(...tuning) + Math.max(...tuning) + 12) / 2)
  let base = mid - (((mid - tonic) % 12) + 12) % 12
  if (base > mid) base -= 12
  return base
}

export interface NumberedGlyph {
  digit: number // 1–7
  accidental: '' | '♯' | '♭'
  octave: number // dots: + above, − below
}

/** How numbered notation usually writes the in-between degrees: ♯1 ♭3 ♯4 ♯5 ♭7. */
const CONVENTIONAL: Record<number, Spelling> = { 1: 'sharp', 3: 'flat', 6: 'sharp', 8: 'sharp', 10: 'flat' }

/**
 * Numbered-notation spelling of a pitch relative to "1" = `base`. Without an explicit spelling
 * (from the note itself), the conventional one for that degree is used.
 */
export function toNumbered(midi: number, base: number, explicit?: Spelling): NumberedGlyph {
  const rel = midi - base
  const pc = ((rel % 12) + 12) % 12
  const spelling = explicit ?? CONVENTIONAL[pc] ?? 'sharp'
  let degreeIndex = MAJOR.indexOf(pc)
  let accidental: NumberedGlyph['accidental'] = ''
  if (degreeIndex === -1) {
    if (spelling === 'flat') {
      degreeIndex = MAJOR.indexOf(pc + 1)
      accidental = '♭'
    } else {
      degreeIndex = MAJOR.indexOf(pc - 1)
      accidental = '♯'
    }
  }
  const natural = MAJOR[degreeIndex] + (accidental === '♭' ? -1 : accidental === '♯' ? 1 : 0)
  return { digit: degreeIndex + 1, accidental, octave: Math.round((rel - natural) / 12) }
}

/**
 * The pitch for degree 1–7 in the same numbered-notation octave (dot row) as `near`, or in the
 * base octave. Typing "1 1 5 5" keeps the 5s in the 1s' row, as written; ↑/↓ change rows.
 */
export function degreeToMidi(degree: number, base: number, near?: number): number {
  const octave = near === undefined ? 0 : toNumbered(near, base, 'sharp').octave
  return base + MAJOR[degree - 1] + 12 * octave
}

/** The pitch for a letter (c–g, a, b) nearest to `near` (or in octave 4). */
export function letterToMidi(letter: string, near?: number): number {
  const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[letter.toLowerCase()]
  if (pc === undefined) throw new Error(`not a note letter: ${letter}`)
  const candidate = 60 + pc
  return near === undefined ? candidate : nearestOctave(candidate, near)
}

function nearestOctave(midi: number, near: number) {
  let best = midi
  for (let k = -4; k <= 4; k++) {
    const m = midi + 12 * k
    if (Math.abs(m - near) < Math.abs(best - near)) best = m
  }
  return best
}

// ---------- edits (one note per beat) ----------

export function noteAt(c: MelodyContent, m: number, b: number): MelodyNote | undefined {
  return c.measures[m]?.beats[b]?.notes[0]
}

/** Sets the beat's pitch (replacing any note); `null` makes it a rest. */
export function setPitch(c: MelodyContent, m: number, b: number, midi: number | null, spelling?: Spelling): MelodyContent {
  return updateBeat(c, m, b, (beat) => ({
    ...beat,
    notes: midi === null ? [] : [{ midi: Math.max(12, Math.min(108, midi)), ...(spelling && isBlack(midi) ? { spelling } : {}) }],
  }))
}

export function shiftOctave(c: MelodyContent, m: number, b: number, dir: 1 | -1): MelodyContent {
  const n = noteAt(c, m, b)
  return n ? setPitch(c, m, b, n.midi + 12 * dir, n.spelling) : c
}

/** Raises/lowers by a semitone; the spelling follows the direction (♯ up, ♭ down). */
export function shiftSemitone(c: MelodyContent, m: number, b: number, dir: 1 | -1): MelodyContent {
  const n = noteAt(c, m, b)
  return n ? setPitch(c, m, b, n.midi + dir, dir > 0 ? 'sharp' : 'flat') : c
}

/** The closest earlier pitch (to choose the octave of a newly typed note). */
export function previousPitch(c: MelodyContent, cur: Cursor): number | undefined {
  let pos: Cursor | null = cur
  while ((pos = stepBeat(c, pos, -1))) {
    const n = noteAt(c, pos.m, pos.b)
    if (n && !n.dead) return n.midi
  }
  return undefined
}

/** Toggles a tie from the previous beat's pitch. */
export function toggleMelodyTie(c: MelodyContent, cur: Cursor): MelodyContent {
  const n = noteAt(c, cur.m, cur.b)
  if (n?.tie) return setPitch(c, cur.m, cur.b, null)
  const prev = stepBeat(c, cur, -1)
  const p = prev && noteAt(c, prev.m, prev.b)
  if (!p) return c
  return updateBeat(c, cur.m, cur.b, (beat) => ({ ...beat, notes: [{ midi: p.midi, ...(p.spelling ? { spelling: p.spelling } : {}), tie: true }] }))
}

/** Moves every pitch by `semitones` (used when a numbered sheet changes key). */
export function transposeMelody(c: MelodyContent, semitones: number): MelodyContent {
  return {
    ...c,
    measures: c.measures.map((mm) => ({
      ...mm,
      beats: mm.beats.map((b) => ({ ...b, notes: b.notes.map((n) => ({ ...n, midi: n.midi + semitones })) })),
    })),
  }
}

// ---------- fretboard positions ----------

export interface Position {
  string: number
  fret: number
}

export function positionsFor(midi: number, tuning: number[], frets: number): Position[] {
  return tuning.flatMap((open, i) => (midi - open >= 0 && midi - open <= frets ? [{ string: i + 1, fret: midi - open }] : []))
}

/**
 * Suggests one position per pitch: the 5-fret box (open strings count in the first one) that
 * covers the most of the pitches, lowest box first; inside it, the lowest fret.
 */
export function suggestPositions(pitches: number[], tuning: number[], frets: number): Map<number, Position> {
  const unique = [...new Set(pitches)]
  let bestStart = 0
  let bestCount = -1
  for (let start = 0; start <= Math.max(0, frets - 4); start++) {
    const inBox = (p: Position) => (p.fret >= start && p.fret <= start + 4) || (start <= 1 && p.fret === 0)
    const count = unique.filter((m) => positionsFor(m, tuning, frets).some(inBox)).length
    if (count > bestCount) [bestStart, bestCount] = [start, count]
  }
  const out = new Map<number, Position>()
  for (const m of unique) {
    const all = positionsFor(m, tuning, frets)
    if (!all.length) continue
    const inBox = all.filter((p) => (p.fret >= bestStart && p.fret <= bestStart + 4) || (bestStart <= 1 && p.fret === 0))
    const pool = inBox.length ? inBox : all
    // Outside the box: the position closest to it.
    pool.sort((a, b) => Math.abs(a.fret - bestStart - 2) - Math.abs(b.fret - bestStart - 2) || a.fret - b.fret)
    out.set(m, pool[0])
  }
  return out
}
