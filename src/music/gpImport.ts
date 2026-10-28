// Guitar Pro / MusicXML import: turns an alphaTab Score (parsed from the file by alphaTab) into
// ordinary editable sheets, one per picked track. Pure: only alphaTab's types are used here, the
// library itself is loaded by the caller (lazily in the app).
//
// alphaTab numbers strings from the lowest (1 = low E) while BePro numbers them from the highest
// (1 = high e, as Sheet.tuning); Staff.tuning is already highest first.

import type { model } from '@coderline/alphatab'
import { DEFAULT_FRETS, defaultTuning, type InstrumentId } from './instruments'
import type { MelodyContent, MelodyNote } from './melody'
import { BEND_STEPS, MAX_FRET, type TabContent, type TabNote } from './tab'
import { DURATIONS, emptyMeasure, splitTicks, uid, WHOLE, type Beat, type Duration, type Measure, type Tuplet } from './rhythm'

type Score = model.Score
type Track = model.Track
type AtBeat = model.Beat
type AtNote = model.Note

/** File types offered in the picker. */
export const GP_EXTENSIONS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.xml', '.musicxml', '.mxl', '.capx']

export interface GpTrackInfo {
  index: number
  name: string
  /** What the track becomes; 'drums' and 'empty' cannot be imported. */
  kind: 'tab' | 'staff' | 'drums' | 'empty'
  instrument: InstrumentId
  tuning: number[] // string 1 (highest) first; empty for non-stringed tracks
  program: number // General MIDI program from the file
}

/**
 * Something in the file that a sheet cannot hold (skipped or approximated), with how often it occurs.
 * `detail` adds specifics, e.g. the tuplet kinds ("7:4") or the capo fret.
 */
export interface GpWarning {
  code:
    | 'capo' | 'staves' | 'voices' | 'repeats' | 'tempoChanges' | 'keyChanges' | 'tuplet' | 'duration'
    | 'whammy' | 'trill' | 'tremolo' | 'harmonic' | 'leftHandTap' | 'slapPop' | 'slide' | 'bend'
  count: number
  detail?: string
}

export interface GpSheet {
  type: 'tab' | 'staff'
  title: string
  instrument: InstrumentId
  tuning: number[] // string 1 (highest) first
  frets: number
  timeSignature: [number, number]
  key: string
  tempo: number
  content: TabContent | MelodyContent
  warnings: GpWarning[]
}

const isStringed = (t: Track) => t.staves[0]?.tuning.length > 0 && !t.isPercussion
const hasNotes = (t: Track) => t.staves.some((s) => s.bars.some((b) => b.voices.some((v) => v.beats.some((x) => x.notes.length > 0))))

function guessInstrument(tuning: number[], program: number): InstrumentId {
  const n = tuning.length
  const low = Math.min(...tuning)
  if (n >= 4 && n <= 6 && ((program >= 32 && program <= 39) || low < 36)) return 'bass'
  if (n === 4 && low >= 55) return 'ukulele'
  if (n >= 6 && n <= 8) return 'guitar'
  return 'custom'
}

/** Tracks of a score, with what each one would become. */
export function listTracks(score: Score): GpTrackInfo[] {
  return score.tracks.map((t) => {
    const program = t.playbackInfo.program
    const tuning = isStringed(t) ? [...t.staves[0].tuning] : []
    // The sheet model holds 4–8 strings; other stringed tracks are imported as notes on a staff.
    const tab = tuning.length >= 4 && tuning.length <= 8
    const kind = t.isPercussion || t.staves[0]?.isPercussion ? 'drums' : !hasNotes(t) ? 'empty' : tab ? 'tab' : 'staff'
    return { index: t.index, name: t.name.trim(), kind, instrument: tab ? guessInstrument(tuning, program) : 'guitar', tuning: tab ? tuning : [], program }
  })
}

// ---------- rhythm ----------

const SUPPORTED_TUPLETS: Record<string, Tuplet> = { '3:2': 3, '5:4': 5, '6:4': 6 }
const SHAPES = DURATIONS.flatMap((d) => [{ duration: d }, { duration: d, dotted: true }])
const shapeTicks = (s: { duration: Duration; dotted?: boolean }) => (WHOLE / s.duration) * (s.dotted ? 1.5 : 1)

interface Rhythm {
  duration: Duration
  dotted?: boolean
  tuplet?: Tuplet
}

/**
 * The beat's length as BePro rhythm values. Lengths the model has no single value for (double dots,
 * breves, unusual tuplets) become several tied values when they add up exactly, else the nearest value.
 */
function rhythmOf(b: AtBeat, warn: Warn): Rhythm[] {
  const d = b.duration as number
  const tupletKey = b.hasTuplet ? `${b.tupletNumerator}:${b.tupletDenominator}` : ''
  const tuplet = tupletKey ? SUPPORTED_TUPLETS[tupletKey] : undefined
  if (tupletKey && !tuplet) warn('tuplet', tupletKey)
  if (DURATIONS.includes(d as Duration) && b.dots <= 1 && (!tupletKey || tuplet)) {
    return [{ duration: d as Duration, ...(b.dots ? { dotted: true } : {}), ...(tuplet ? { tuplet } : {}) }]
  }
  const ticks =
    (d > 0 ? WHOLE / d : WHOLE * -d) * (b.dots >= 2 ? 1.75 : b.dots === 1 ? 1.5 : 1) * (tupletKey ? b.tupletDenominator / b.tupletNumerator : 1)
  const parts = splitTicks(ticks)
  if (b.graceType === 0 && Math.abs(parts.reduce((t, p) => t + shapeTicks(p), 0) - ticks) < 0.5) return parts
  if (!tupletKey || tuplet) warn('duration')
  const nearest = SHAPES.reduce((best, s) => (Math.abs(shapeTicks(s) - ticks) < Math.abs(shapeTicks(best) - ticks) ? s : best))
  return [nearest]
}

// ---------- conversion ----------

type Warn = (code: GpWarning['code'], detail?: string) => void

function warnings() {
  const found = new Map<GpWarning['code'], { count: number; details: Set<string> }>()
  const warn: Warn = (code, detail) => {
    const w = found.get(code) ?? { count: 0, details: new Set<string>() }
    w.count++
    if (detail) w.details.add(detail)
    found.set(code, w)
  }
  const list = (): GpWarning[] =>
    [...found].map(([code, w]) => ({ code, count: w.count, ...(w.details.size ? { detail: [...w.details].join(', ') } : {}) }))
  return { warn, list }
}

const MAJOR_KEYS: Record<number, string> = { [-7]: 'B', [-6]: 'F#', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'Db' }
const MINOR_KEYS: Record<number, string> = { [-7]: 'G#m', [-6]: 'Ebm', [-5]: 'Bbm', [-4]: 'Fm', [-3]: 'Cm', [-2]: 'Gm', [-1]: 'Dm', 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'Ebm', 7: 'Bbm' }

/** Key name (as in KEYS) for an alphaTab key signature (sharps > 0, flats < 0; type 1 = minor). */
export function keyName(signature: number, type: number) {
  return (type === 1 ? MINOR_KEYS : MAJOR_KEYS)[signature] ?? 'C'
}

/** BePro note for an alphaTab note on a stringed track (null: nothing to keep). */
function tabNote(n: AtNote, strings: number, warn: Warn): TabNote | null {
  const string = strings - n.string + 1
  if (string < 1 || string > strings) return null
  if (n.isTieDestination) return { string, fret: n.fret, tie: true }
  const out: TabNote = n.isDead ? { string, fret: 0, dead: true } : { string, fret: Math.max(0, Math.min(MAX_FRET, n.fret)) }
  if (!n.isDead) {
    const dest = n.isHammerPullOrigin ? n.hammerPullDestination : null
    if (dest) out.legato = dest.fret >= n.fret ? 'h' : 'p'
    // Slide out (shift / legato slide / out of the note) is kept over slide in when a note has both.
    const out_ = n.slideOutType as number
    const in_ = n.slideInType as number
    if (out_ === 1 || out_ === 2) out.slide = 'to'
    else if (out_ === 3) out.slide = 'outUp'
    else if (out_ === 4) out.slide = 'outDown'
    else if (in_ === 1) out.slide = 'inBelow'
    else if (in_ === 2) out.slide = 'inAbove'
    if (out_ >= 5 || (out_ && in_)) warn('slide')
    if (n.hasBend) {
      const type = n.bendType as number
      const points = n.bendPoints ?? []
      const max = n.maxBendPoint?.value ?? 0
      if (type === 3 || type === 5 || max <= 0) warn('bend') // release / hold of an earlier bend
      else {
        const steps = max / 4 // bend values are quarter tones
        out.bend = BEND_STEPS.reduce((best, s) => (Math.abs(s - steps) < Math.abs(best - steps) ? s : best))
        if (type === 4 || type === 8 || (type === 1 && points.length > 0 && points[points.length - 1].value < max)) out.release = true
        if (type >= 6 || Math.abs(out.bend - steps) > 0.01) warn('bend') // pre-bends and unusual amounts are approximated
      }
    }
    const harmonic = n.harmonicType as number
    if (harmonic === 1) out.harmonic = 'natural'
    else if (harmonic === 2) out.harmonic = 'artificial'
    else if (harmonic > 2) warn('harmonic')
    if ((n.vibrato as number) !== 0 || (n.beat.vibrato as number) !== 0) out.vibrato = true
    if (n.isGhost) out.ghost = true
    if (n.beat.tap) out.tap = true
    if (n.isLeftHandTapped) warn('leftHandTap')
    if (n.isTrill) warn('trill')
  }
  if (n.isPalmMute) out.palmMute = true
  if (n.isLetRing) out.letRing = true
  return out
}

function melodyNote(n: AtNote, warn: Warn): MelodyNote {
  if (n.isTrill) warn('trill')
  return n.isTieDestination ? { midi: n.realValue, tie: true } : { midi: n.realValue }
}

/** Notes continuing a beat that was split into tied values. */
function continued<N extends TabNote | MelodyNote>(notes: N[]): N[] {
  return notes.filter((n) => !n.dead).map((n) => ('fret' in n ? { string: n.string, fret: n.fret, tie: true } : { midi: n.midi, tie: true }) as N)
}

function convertVoice<N extends TabNote | MelodyNote>(beats: AtBeat[], noteOf: (n: AtNote) => N | null, warn: Warn): Beat<N>[] {
  const out: Beat<N>[] = []
  for (const b of beats) {
    if (b.hasWhammyBar) warn('whammy')
    if (b.isTremolo) warn('tremolo')
    if (b.slap || b.pop) warn('slapPop')
    const notes = b.isRest || b.isEmpty ? [] : b.notes.map(noteOf).filter((n): n is N => n !== null)
    const chord = b.chord?.name.trim()
    const lyric = b.lyrics?.map((l) => l.trim()).find(Boolean)
    for (const [i, r] of rhythmOf(b, warn).entries()) {
      out.push({
        id: uid(),
        ...r,
        ...(b.graceType !== 0 ? { grace: true } : {}),
        ...(i === 0 && chord ? { chord } : {}),
        ...(i === 0 && lyric ? { lyric } : {}),
        notes: i === 0 ? notes : continued(notes),
      })
    }
  }
  return out
}

/** Converts one track into a sheet. `title` is the sheet title (song title, plus the track name if wanted). */
export function convertTrack(score: Score, trackIndex: number, title: string): GpSheet {
  const track = score.tracks[trackIndex]
  const info = listTracks(score)[trackIndex]
  if (!track || !info || info.kind === 'drums' || info.kind === 'empty') throw new Error(`track ${trackIndex} cannot be imported`)
  const { warn, list } = warnings()
  const staff = track.staves[0]
  const tab = info.kind === 'tab'
  const strings = info.tuning.length
  const noteOf = (n: AtNote): TabNote | MelodyNote | null => (tab ? tabNote(n, strings, warn) : melodyNote(n, warn))

  const first = score.masterBars[0]
  const timeSignature: [number, number] = [first?.timeSignatureNumerator ?? 4, first?.timeSignatureDenominator ?? 4]
  let ts = timeSignature
  const measures: Measure<TabNote | MelodyNote>[] = staff.bars.map((bar, i) => {
    const mb = score.masterBars[bar.index]
    const here: [number, number] = [mb.timeSignatureNumerator, mb.timeSignatureDenominator]
    const change = i > 0 && (here[0] !== ts[0] || here[1] !== ts[1])
    ts = here
    const [v1, v2, ...more] = bar.voices
    // Empty or rest-only voices (incl. a whole-bar rest) become rests that fill the bar exactly.
    const main = !v1 || v1.isEmpty || v1.isRestOnly ? (emptyMeasure(here).beats as Beat<TabNote | MelodyNote>[]) : convertVoice(v1.beats, noteOf, warn)
    const second = v2 && !v2.isEmpty && !v2.isRestOnly ? convertVoice(v2.beats, noteOf, warn) : undefined
    if (more.some((v) => !v.isEmpty && !v.isRestOnly)) warn('voices')
    if (i > 0 && mb.keySignature !== first.keySignature) warn('keyChanges')
    if (mb.isRepeatStart || mb.isRepeatEnd || mb.alternateEndings) warn('repeats')
    if (mb.tempoAutomations.some((a) => a.value !== score.tempo)) warn('tempoChanges')
    return { id: uid(), ...(change ? { timeSignature: here } : {}), beats: main, ...(second ? { voice2: second } : {}) }
  })
  if (tab && staff.capo > 0) warn('capo', String(staff.capo))
  if (track.staves.slice(1).some((s) => s.bars.some((b) => b.voices.some((v) => !v.isEmpty && !v.isRestOnly)))) warn('staves')

  // Staff sheets of non-stringed tracks: bass clef for low parts, else guitar (treble clef).
  const pitches = tab ? [] : measures.flatMap((m) => m.beats.flatMap((b) => b.notes.map((n) => (n as MelodyNote).midi)))
  const instrument: InstrumentId = tab ? info.instrument : pitches.length && pitches.reduce((a, b) => a + b, 0) / pitches.length < 48 ? 'bass' : 'guitar'
  const maxFret = tab ? Math.max(0, ...measures.flatMap((m) => [...m.beats, ...(m.voice2 ?? [])].flatMap((b) => b.notes.map((n) => (n as TabNote).fret)))) : 0
  const tempo = Math.round(Math.max(20, Math.min(300, score.tempo || 100)))

  return {
    type: tab ? 'tab' : 'staff',
    title,
    instrument,
    tuning: tab ? info.tuning : defaultTuning(instrument, instrument === 'bass' ? 4 : 6),
    frets: Math.min(MAX_FRET, Math.max(DEFAULT_FRETS[instrument], maxFret)),
    timeSignature,
    key: keyName(first?.keySignature ?? 0, first?.keySignatureType ?? 0),
    tempo,
    content: { kind: tab ? 'tab' : 'melody', version: 1, measures } as TabContent | MelodyContent,
    warnings: list(),
  }
}

/** Sheet title for a track: the song title (or file name), plus the track name when the file has several tracks. */
export function trackTitle(score: Score, trackIndex: number, fileName: string) {
  const song = score.title.trim() || fileName.replace(/\.[^.]+$/, '')
  const parts = listTracks(score).filter((t) => t.kind !== 'empty')
  const name = score.tracks[trackIndex]?.name.trim()
  return parts.length > 1 && name ? `${song} - ${name}` : song
}
