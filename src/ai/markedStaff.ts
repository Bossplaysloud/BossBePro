// Standard notation (classical guitar first) where the app finds the staves and measures, the AI
// copies what is printed — note-head positions, printed accidentals, note values — and the app
// applies the rules of notation:
//
// - Pitch: the key signature alters its letters in every octave; a printed accidental holds for the
//   rest of the measure on that line or space (same octave only), in every voice of the staff; a
//   bar line cancels it, except for a note tied across the bar line. Guitar sounds an octave lower.
// - Ties join the same pitch (the second note is held, not played); slurs are only phrasing.
// - Values: dots add half, then a quarter; tuplets fit `actual` notes in the time of `normal`
//   (3:2, 5:4, 6:4, 7:4; in compound time 2:3 and 4:3). Values the editor cannot hold (double dots,
//   duplets, …) become tied notes of plain or dotted values.
// - Each voice should fill the measure; a whole rest fills it in any time signature; grace notes
//   take no time (kept as grace notes before the next note).

import { measureLength } from './rhythmFix'
import { tupletOf, tupletRatio, type Recognition, type RecognizedBeat } from './schema'
import type { Detection } from '../lib/tabDetect'
import { TUPLETS } from '../music/rhythm'

export interface StaffMeasure {
  no: number // 1-based within the image
  staff: number // index into the detected staves
  x0: number
  x1: number
}

export interface StaffLayout {
  measures: StaffMeasure[]
}

/** Measures of every five-line staff, in reading order (bar lines plus the staff ends). */
export function staffLayout(d: Detection): StaffLayout | null {
  const measures: StaffMeasure[] = []
  d.staves.forEach((s, i) => {
    if (s.kind !== 'staff') return
    const bounds = [...s.barLines].sort((a, b) => a - b)
    if (!bounds.length || bounds[0] > s.x0 + s.spacing * 3) bounds.unshift(s.x0)
    if (bounds[bounds.length - 1] < s.x1 - s.spacing * 3) bounds.push(s.x1)
    for (let k = 0; k + 1 < bounds.length; k++) {
      if (bounds[k + 1] - bounds[k] < s.spacing * 3) continue
      measures.push({ no: measures.length + 1, staff: i, x0: bounds[k], x1: bounds[k + 1] })
    }
  })
  return measures.length ? { measures } : null
}

/** The image to send: enlarged when the print is small, bar lines traced and each measure numbered under the staff. */
export function markStaffImage(src: HTMLCanvasElement, d: Detection, layout: StaffLayout): HTMLCanvasElement {
  const staves = d.staves.filter((s) => s.kind === 'staff')
  const spacing = Math.min(...staves.map((s) => s.spacing))
  const f = Math.max(1, Math.min(18 / spacing, 2400 / Math.max(src.width, src.height)))
  const out = document.createElement('canvas')
  out.width = Math.round(src.width * f)
  out.height = Math.round(src.height * f)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, out.width, out.height)
  for (const m of layout.measures) {
    const s = d.staves[m.staff]
    const top = s.lines[0] * f
    const bottom = s.lines[s.lines.length - 1] * f
    ctx.strokeStyle = 'rgba(229, 57, 53, 0.55)'
    ctx.lineWidth = Math.max(1, f)
    for (const x of [m.x0, m.x1]) {
      ctx.beginPath()
      ctx.moveTo(x * f, top)
      ctx.lineTo(x * f, bottom)
      ctx.stroke()
    }
    // The number sits above the staff just left of the measure's opening bar line: printed measure
    // numbers stand right of it, and notes rarely stand right before a bar line that high.
    const size = Math.max(10, Math.round(s.spacing * f * 0.95))
    ctx.font = `bold ${size}px sans-serif`
    ctx.fillStyle = '#e53935'
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'right'
    ctx.fillText(`M${m.no}`, m.x0 * f - s.spacing * f * 0.15, top - s.spacing * f * 0.35)
  }
  return out
}

const ACCIDENTALS = ['none', 'sharp', 'flat', 'natural', 'doubleSharp', 'doubleFlat'] as const
type Accidental = (typeof ACCIDENTALS)[number]

export const STAFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'tempo', 'timeSignature', 'keySignature', 'key', 'measures', 'warnings'],
  properties: {
    title: { type: ['string', 'null'] },
    tempo: { type: ['integer', 'null'] },
    timeSignature: { type: ['string', 'null'], description: 'Starting time signature, e.g. "3/4", "6/8"; "C" is "4/4", "¢" is "2/2"' },
    keySignature: { type: 'integer', description: 'Sharps in the starting key signature as a positive number, flats as a negative number, 0 for none' },
    key: { type: ['string', 'null'], description: 'The key if you can tell it, e.g. "E", "Em", "A"' },
    measures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['measure', 'keySignature', 'timeSignature', 'repeatPrevious', 'voices'],
        properties: {
          measure: { type: 'integer', description: 'The red measure number M1, M2, …' },
          repeatPrevious: { type: 'boolean', description: 'The measure holds only a repeat sign (a slash between two dots, ⁒): it repeats the previous measure. Then give no voices.' },
          keySignature: { type: ['integer', 'null'], description: 'Only when a new key signature starts here' },
          timeSignature: { type: ['string', 'null'], description: 'Only when a new time signature starts here' },
          voices: {
            type: 'array',
            description: 'One voice when all notes share stems; two when upper notes (stems up) and lower notes (stems down, e.g. the bass) have their own rhythm',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['voice', 'events'],
              properties: {
                voice: { type: 'integer', description: '1 = the only or upper voice (stems up), 2 = the lower voice (stems down)' },
                events: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['rest', 'notes', 'value', 'dots', 'tuplet', 'grace', 'chord'],
                    properties: {
                      rest: { type: 'boolean' },
                      chord: { type: ['string', 'null'], description: 'A chord symbol printed above the staff starting at this event (voice 1 only), in standard spelling: "Bb-7" or "Bbmi7" → "Bbm7", "Δ" → "maj7", "ø" → "m7b5", "°" → "dim"; null when none starts here' },
                      notes: {
                        type: 'array',
                        description: 'Every note head on this stem, lowest first; empty for a rest',
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['position', 'accidental', 'tie', 'string', 'finger'],
                          properties: {
                            position: { type: 'string', description: 'The line or space the head sits on, named as written in this clef, without the key signature: letter + octave, e.g. "E4" (bottom line of the treble clef), "F5" (top line), "C4" (one ledger line below)' },
                            accidental: { type: 'string', enum: [...ACCIDENTALS], description: 'An accidental printed right before this head (not the key signature); "none" if nothing is printed' },
                            tie: { type: 'boolean', description: 'A tie (curved line) goes from this head to the same pitch in the next chord of this voice. Slurs between different pitches are not ties.' },
                            string: { type: ['integer', 'null'], description: 'Circled string number (①–⑥) for this note, if printed' },
                            finger: { type: ['integer', 'null'], description: 'Left-hand finger 0–4 printed beside this head, if any (not a tuplet number)' },
                          },
                        },
                      },
                      value: { type: 'string', enum: ['1', '2', '4', '8', '16', '32', '64'], description: 'Written value: 1 whole (hollow, no stem), 2 half (hollow with stem), 4 quarter (filled), 8 one flag or beam, 16 two, 32 three. A whole rest fills the measure: give "1".' },
                      dots: { type: 'integer', description: 'Dots after the note or rest: 0, 1 or 2' },
                      tuplet: { type: 'integer', description: 'The number of a tuplet bracket over this note (3 triplet, 2 duplet, 4, 5, 6 …); 0 when there is none' },
                      grace: { type: 'boolean', description: 'A small grace note (with or without a slash), which takes no time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
}

export interface StaffNoteAnswer {
  position: string
  accidental: Accidental
  tie: boolean
  string: number | null
  finger: number | null
}

export interface StaffEventAnswer {
  rest: boolean
  chord?: string | null
  notes: StaffNoteAnswer[]
  value: '1' | '2' | '4' | '8' | '16' | '32' | '64'
  dots: number
  tuplet: number
  grace: boolean
}

export interface StaffAnswer {
  title: string | null
  tempo: number | null
  timeSignature: string | null
  keySignature: number
  key: string | null
  measures: { measure: number; keySignature: number | null; timeSignature: string | null; repeatPrevious?: boolean; voices: { voice: number; events: StaffEventAnswer[] }[] }[]
  warnings: string[]
}

export function buildStaffPrompt(layout: StaffLayout, opts: { language: 'zh-TW' | 'en'; context?: string }) {
  const nos = layout.measures.map((m) => m.no)
  const lang = opts.language === 'zh-TW' ? 'Traditional Chinese (繁體中文)' : 'English'
  return [
    'This image is standard music notation for classical guitar (treble clef; the guitar sounds an octave lower than written, which the app handles).',
    `I have found the measures: their bar lines are traced in red and each is numbered in red above the staff just left of its opening bar line, M${nos[0]} to M${nos[nos.length - 1]}. Transcribe every one of them, in that order.`,
    '',
    'Copy only what is printed; the app applies the rules (key signature, accidentals lasting through the measure, ties, octave). In particular:',
    '- position: name the line or space each note head sits on as written in the clef, ignoring the key signature (a head on the top line of the treble clef is "F5" even in a sharp key). Count ledger lines carefully.',
    '  Treble clef reference: lines bottom to top E4 G4 B4 D5 F5; spaces bottom to top F4 A4 C5 E5; just under the bottom line D4, on one ledger line below C4; just above the top line G5, on one ledger line above A5. Check each head by counting from the nearest line, not by guessing from the shape of the melody.',
    '- accidental: only an accidental printed right before that head; "none" otherwise, even if an earlier accidental in the measure still applies.',
    '- One event per stem (a chord is one event with several heads), left to right, plus rests. Values from the head and the flags or beams: hollow without stem = 1, hollow with stem = 2, filled = 4, one flag or beam = 8, two = 16, three = 32; dots 1 or 2.',
    '- Voices: if the notes with stems down (usually the bass) have their own rhythm, put them in voice 2 and the stems-up notes in voice 1; each voice must add up to the time signature (rests included). Otherwise use voice 1 only.',
    '- tuplet: the number of a tuplet bracket or number over a group (3, 2, 4, 5, 6) on every note of that group; 0 otherwise. Small numbers right beside a note head are fingers, not tuplets.',
    '- tie: a curved line from a head to the same pitch in the next event of the voice. A curve between different pitches is a slur: ignore it.',
    '- Circled numbers are strings; plain small numbers 0–4 beside a head are left-hand fingers; letters p i m a are right-hand fingers (ignore them). Grace notes: mark grace true.',
    '- Chord symbols above the staff (lead sheets): put each on the voice-1 event at or just after where it is written, spelled in standard form.',
    '- Handwritten music: read every note head carefully against the lines (count from the nearest line), and every beam: one beam = eighths, two = sixteenths. A "3" over or under a group is a triplet, a "6" a sextuplet. A measure with only a slash between two dots repeats the previous measure: set repeatPrevious.',
    '- Rests count: a whole or half rest (a small block on or under the middle line), quarter rests, eighth rests. Each voice must add up to the time signature.',
    'Also give the key signature as a count (sharps positive, flats negative), the time signature, tempo (the number in a mark like "♩ = 120" above the first line; null if none) and title if shown.',
    opts.context ?? '',
    '',
    `Write warnings in ${lang}.`,
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
}

// ---------- the rules ----------

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const NATURAL = [0, 2, 4, 5, 7, 9, 11]
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const ALTER: Record<Accidental, number> = { none: 0, sharp: 1, flat: -1, natural: 0, doubleSharp: 2, doubleFlat: -2 }

/** The alteration the key signature gives a letter: +1 for sharps, −1 for flats. */
export function keyAlter(count: number, letter: string) {
  const i = SHARP_ORDER.indexOf(letter)
  if (count > 0) return i < count ? 1 : 0
  if (count < 0) return 6 - i < -count ? -1 : 0
  return 0
}

/** "E4" → letter, octave and the MIDI number of the natural note. */
export function parsePosition(text: string): { letter: string; octave: number; natural: number } | null {
  const m = /^\s*([A-Ga-g])\s*(-?\d)\s*$/.exec(text)
  if (!m) return null
  const letter = m[1].toUpperCase()
  const octave = Number(m[2])
  return { letter, octave, natural: 12 * (octave + 1) + NATURAL[LETTERS.indexOf(letter)] }
}

/** Major key with that many sharps (+) or flats (−). */
export function keyName(count: number) {
  return ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'][Math.max(-7, Math.min(7, count)) + 7]
}

const compound = (ts: [number, number]) => ts[0] % 3 === 0 && ts[0] > 3 && ts[1] >= 8

/** Played length in 32nds of a written value with dots and a tuplet. */
export function eventLength(e: Pick<StaffEventAnswer, 'value' | 'dots' | 'tuplet'>, ts: [number, number]) {
  const base = 32 / Number(e.value)
  const dotted = base * (e.dots >= 2 ? 1.75 : e.dots === 1 ? 1.5 : 1)
  const actual = e.tuplet
  if (!actual || actual === 1) return dotted
  const normal = actual === 2 || (actual === 4 && compound(ts)) ? 3 : 2 ** Math.floor(Math.log2(actual))
  return (dotted * normal) / actual
}

/** Plain and dotted values in 32nds, longest first. */
const PIECES: { len: number; duration: RecognizedBeat['duration']; dotted: boolean }[] = [
  { len: 48, duration: '1', dotted: true },
  { len: 32, duration: '1', dotted: false },
  { len: 24, duration: '2', dotted: true },
  { len: 16, duration: '2', dotted: false },
  { len: 12, duration: '4', dotted: true },
  { len: 8, duration: '4', dotted: false },
  { len: 6, duration: '8', dotted: true },
  { len: 4, duration: '8', dotted: false },
  { len: 3, duration: '16', dotted: true },
  { len: 2, duration: '16', dotted: false },
  { len: 1, duration: '32', dotted: false },
]

/** How an event is stored: one beat when the editor can hold it, otherwise tied plain/dotted beats. */
function beatShapes(e: StaffEventAnswer, ts: [number, number]): Pick<RecognizedBeat, 'duration' | 'dotted' | 'tuplet'>[] {
  const len = eventLength(e, ts)
  const plainDots = e.dots <= 1 && Number(e.value) <= 32
  if (!e.tuplet && plainDots) return [{ duration: e.value as RecognizedBeat['duration'], dotted: e.dots === 1, tuplet: 0 }]
  // Triplets, quintuplets and sextuplets the editor holds as they are (6 in the time of 4 …).
  if ((TUPLETS as number[]).includes(e.tuplet) && plainDots && Math.abs(len - eventLength(e, [4, 4])) < 1e-9) return [{ duration: e.value as RecognizedBeat['duration'], dotted: e.dots === 1, tuplet: e.tuplet }]
  const exact = PIECES.find((p) => Math.abs(p.len - len) < 1e-9)
  if (exact) return [{ duration: exact.duration, dotted: exact.dotted, tuplet: 0 }]
  // Split into tied pieces (32nd precision).
  const out: Pick<RecognizedBeat, 'duration' | 'dotted' | 'tuplet'>[] = []
  let left = Math.max(1, Math.round(len))
  for (const p of PIECES) while (left >= p.len) (out.push({ duration: p.duration, dotted: p.dotted, tuplet: 0 }), (left -= p.len))
  return out
}

/** A note as the import step expects it: written MIDI (before the guitar octave), spelling, tie, string, finger. */
export interface WrittenNote {
  midi: number
  spelling?: 'sharp' | 'flat'
  tie?: boolean
  string?: number
  finger?: number
}

const playedLen = (b: Pick<RecognizedBeat, 'duration' | 'dotted' | 'tuplet' | 'triplet' | 'grace'>) => (b.grace ? 0 : (32 / Number(b.duration)) * (b.dotted ? 1.5 : 1) * tupletRatio(tupletOf(b)))

function blank(shape: Pick<RecognizedBeat, 'duration' | 'dotted' | 'tuplet'>, notes: WrittenNote[] = []): RecognizedBeat {
  return { ...shape, chord: null, lyric: null, tab: [], pitch: null, degree: null, tie: false, x: null, notes }
}

/** Rests filling `len` 32nds. */
function rests(len: number): RecognizedBeat[] {
  const out: RecognizedBeat[] = []
  let left = Math.round(len)
  for (const p of PIECES) while (left >= p.len) (out.push(blank({ duration: p.duration, dotted: p.dotted, tuplet: 0 })), (left -= p.len))
  return out
}

/** Applies the rules of notation to the AI's copy and returns a transcription for the import step. */
export function staffToRecognition(a: StaffAnswer, layout: StaffLayout): Recognition {
  const warnings = [...(a.warnings ?? [])]
  const parseTs = (t: string | null | undefined): [number, number] | null => {
    const s = (t ?? '').trim()
    if (s === 'C') return [4, 4]
    if (s === '¢') return [2, 2]
    const m = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(s)
    return m && [2, 4, 8, 16].includes(Number(m[2])) ? [Number(m[1]), Number(m[2])] : null
  }
  let ts = parseTs(a.timeSignature) ?? [4, 4]
  let keySig = Math.max(-7, Math.min(7, Math.round(a.keySignature ?? 0)))
  // Notes tied from the previous event, per voice: position → alteration (also across bar lines).
  let tiedFrom: Map<string, number>[] = [new Map(), new Map()]
  let previous: Recognition['measures'][number] | null = null
  const measures = layout.measures.map((m) => {
    const ans = a.measures?.find((x) => x.measure === m.no)
    // A repeat sign (⁒): the previous measure again.
    if (ans?.repeatPrevious && previous && !ans.voices?.some((v) => v.events?.length)) {
      const copy = (bs: RecognizedBeat[]) => bs.map((b) => ({ ...b, notes: b.notes?.map((n) => ({ ...n, tie: undefined })) }))
      previous = { ...previous, timeSignature: null, beats: copy(previous.beats), ...(previous.voice2 ? { voice2: copy(previous.voice2) } : {}) }
      return previous
    }
    const tsChange = parseTs(ans?.timeSignature)
    if (tsChange) ts = tsChange
    if (ans?.keySignature != null) keySig = Math.max(-7, Math.min(7, Math.round(ans.keySignature)))
    const total = measureLength(ts)
    const voices = [...(ans?.voices ?? [])].sort((x, y) => x.voice - y.voice).slice(0, 2)
    // Onsets let accidentals apply in time order across both voices.
    type Item = { voice: number; onset: number; event: StaffEventAnswer }
    const items: Item[] = []
    voices.forEach((v, vi) => {
      let t = 0
      for (const e of v.events ?? []) {
        // Grace notes take no time; a whole rest fills the measure whatever the time signature.
        const len = e.grace ? 0 : e.rest && e.value === '1' && !e.dots ? total : eventLength(e, ts)
        items.push({ voice: vi, onset: t, event: e })
        t += len
      }
    })
    const inMeasure = new Map<string, number>() // accidentals printed so far in this measure
    const resolved = new Map<Item, WrittenNote[]>()
    // Voices in time order for accidentals; each voice keeps its own ties.
    const byVoice = [0, 1].map((vi) => items.filter((x) => x.voice === vi))
    for (const it of [...items].sort((x, y) => x.onset - y.onset || x.voice - y.voice)) {
      const vi = it.voice
      const incoming = tiedFrom[vi]
      const outgoing = new Map<string, number>()
      const notes: WrittenNote[] = []
      for (const n of it.event.rest ? [] : it.event.notes ?? []) {
        const p = parsePosition(n.position)
        if (!p) continue
        const at = `${p.letter}${p.octave}`
        const tiedIn = incoming.has(at)
        let alter: number
        if (n.accidental !== 'none') {
          alter = ALTER[n.accidental]
          inMeasure.set(at, alter)
        } else if (tiedIn) alter = incoming.get(at)! // a tied note keeps its pitch, even over the bar line
        else if (inMeasure.has(at)) alter = inMeasure.get(at)!
        else alter = keyAlter(keySig, p.letter)
        if (n.tie) outgoing.set(at, alter)
        notes.push({
          midi: p.natural + alter,
          ...(alter < 0 ? { spelling: 'flat' as const } : alter > 0 ? { spelling: 'sharp' as const } : {}),
          ...(tiedIn ? { tie: true } : {}),
          ...(n.string != null && n.string >= 1 && n.string <= 6 ? { string: n.string } : {}),
          ...(n.finger != null && n.finger >= 0 && n.finger <= 4 ? { finger: n.finger } : {}),
        })
      }
      tiedFrom[vi] = outgoing // ties reach only the next event of the voice
      resolved.set(it, notes.sort((x, y) => x.midi - y.midi))
    }
    // A voice missing in this measure drops its ties.
    tiedFrom = tiedFrom.map((t, vi) => (byVoice[vi].length ? t : new Map()))
    // Beats per voice: one per event, or tied pieces for values the editor cannot hold.
    const beatsOf = (vi: number) => {
      const out: RecognizedBeat[] = []
      for (const it of items.filter((x) => x.voice === vi)) {
        const notes = resolved.get(it) ?? []
        const e = it.event
        if (e.grace) {
          const value = (['8', '16', '32'] as const).find((v) => v === e.value) ?? '8'
          out.push({ ...blank({ duration: value, dotted: false, tuplet: 0 }, notes), grace: true })
          continue
        }
        const chord = vi === 0 && e.chord?.trim() ? e.chord.trim() : null
        const shapes = e.rest && e.value === '1' && !e.dots ? rests(total).map((b) => ({ duration: b.duration, dotted: b.dotted, tuplet: b.tuplet })) : beatShapes(e, ts)
        shapes.forEach((shape, k) => out.push({ ...blank(shape, k === 0 ? notes : notes.map((n) => ({ ...n, tie: true, finger: undefined }))), ...(k === 0 && chord ? { chord } : {}) }))
      }
      return out
    }
    const v1 = beatsOf(0)
    let v2 = voices.length > 1 ? beatsOf(1) : []
    const len = (bs: RecognizedBeat[]) => bs.reduce((t, b) => t + playedLen(b), 0)
    // The lower voice is often written only where it plays: fill the rest of the measure with rests.
    if (v2.length && len(v2) < total) v2 = [...v2, ...rests(total - len(v2))]
    // A voice 1 that does not add up is reported by the import step's measure check.
    previous = { timeSignature: tsChange ? `${ts[0]}/${ts[1]}` : null, beats: v1, start: null, end: null, ...(v2.length ? { voice2: v2 } : {}) }
    return previous
  })
  const tsText = parseTs(a.timeSignature)
  return {
    notation: 'staff',
    title: a.title,
    strings: 6,
    tuning: null,
    key: a.key && /^[A-G][#b]?m?$/.test(a.key.trim()) ? a.key.trim() : keyName(Math.round(a.keySignature ?? 0)),
    timeSignature: tsText ? `${tsText[0]}/${tsText[1]}` : null,
    tempo: a.tempo,
    capo: null,
    measures,
    chart: { originalKey: null, writtenKey: null, maleKey: null, femaleKey: null, patterns: [], sections: [] },
    warnings,
  }
}

// ---------- one request per line of music ----------

export interface StaffGroup {
  y0: number
  y1: number
  /** Left and right ends of the staff, with room for the clef and the end bar line. */
  x0: number
  x1: number
  spacing: number
  measures: number[]
}

/** Each staff with room above (chord symbols, high notes, brackets) and below, and its measures. */
export function staffGroups(d: Detection, layout: StaffLayout): StaffGroup[] {
  const staffIds = [...new Set(layout.measures.map((m) => m.staff))].sort((a, b) => a - b)
  return staffIds.map((i, n) => {
    const s = d.staves[i]
    return {
      // The first line also takes in the tempo mark and heading printed above it.
      y0: Math.max(0, s.lines[0] - s.spacing * (n === 0 ? 12 : 6)),
      y1: Math.min(d.height, s.lines[s.lines.length - 1] + s.spacing * 5),
      x0: Math.max(0, s.x0 - s.spacing * 2),
      x1: Math.min(d.width, s.x1 + s.spacing * 2),
      spacing: s.spacing,
      measures: layout.measures.filter((m) => m.staff === i).map((m) => m.no),
    }
  })
}

export function subStaffLayout(layout: StaffLayout, g: StaffGroup): StaffLayout {
  return { measures: layout.measures.filter((m) => g.measures.includes(m.no)) }
}

/** Joins the answers for each line: settings from the first that gives them, measures in order. */
export function mergeStaffAnswers(parts: StaffAnswer[]): StaffAnswer {
  const first = <K extends keyof StaffAnswer>(k: K) => parts.map((p) => p[k]).find((v) => v !== null && v !== undefined && v !== '') ?? null
  return {
    title: first('title') as string | null,
    tempo: first('tempo') as number | null,
    timeSignature: first('timeSignature') as string | null,
    keySignature: (parts.find((p) => p.keySignature)?.keySignature ?? parts[0]?.keySignature ?? 0) as number,
    key: first('key') as string | null,
    measures: parts.flatMap((p) => p.measures ?? []),
    warnings: parts.flatMap((p) => p.warnings ?? []),
  }
}
