import type { Slide, TabBeat, TabContent, TabNote } from './tab'
import { keyTonic } from './chords'
import { KEY_SIGNATURE_NAMES, defaultSpelling, texPitch, type MelodyBeat, type MelodyContent } from './melody'
import { measureCapacity, type Beat } from './rhythm'

const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']

export function midiToTex(midi: number) {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const SLIDE_TEX: Record<Slide, string> = { to: 'sl', inBelow: 'sib', inAbove: 'sia', outDown: 'sod', outUp: 'sou' }

function noteTex(n: TabNote) {
  if (n.tie) return `-.${n.string}`
  const fx: string[] = []
  if (!n.dead) {
    if (n.legato) fx.push('h') // alphaTab draws H or P from the fret direction
    if (n.slide) fx.push(SLIDE_TEX[n.slide])
    if (n.bend) {
      const v = Math.round(n.bend * 4) // alphaTab bend values are quarter tones
      fx.push(n.release ? `b (0 ${v} ${v} 0)` : `b (0 ${v})`)
    }
    if (n.harmonic) fx.push(n.harmonic === 'natural' ? 'nh' : 'ah')
    if (n.vibrato) fx.push('v')
    if (n.ghost) fx.push('g')
  }
  if (n.palmMute) fx.push('pm')
  if (n.letRing) fx.push('lr')
  return `${n.dead ? 'x' : n.fret}.${n.string}${fx.length ? `{${fx.join(' ')}}` : ''}`
}

function beatTex(beat: TabBeat, strings: number) {
  const notes = beat.notes.filter((n) => n.string >= 1 && n.string <= strings)
  const head = notes.length === 0 ? 'r' : notes.length === 1 ? noteTex(notes[0]) : `(${notes.map(noteTex).join(' ')})`
  // alphaTab marks tapping per beat ("T" above the staff).
  const tap = notes.some((n) => n.tap && !n.dead && !n.tie)
  return `${head}.${beat.duration}${beatFx(beat, tap ? ['tt'] : [])}`
}

function beatFx(beat: Beat, extra: string[] = []) {
  const fx = [
    ...extra,
    beat.grace ? 'gr' : '',
    beat.dotted ? 'd' : '',
    beat.tuplet ? `tu ${beat.tuplet}` : '',
    beat.chord ? `ch ${quote(beat.chord)}` : '',
    beat.lyric ? `lyrics ${quote(beat.lyric)}` : '',
  ].filter(Boolean)
  return fx.length ? ` {${fx.join(' ')}}` : ''
}

export interface TexOptions {
  title: string
  tempo: number
  tuning: number[] // string 1 (highest) first
  timeSignature: [number, number]
  program?: number // General MIDI instrument used for playback
}

/** Converts TAB content into alphaTex for rendering (and later playback / Guitar Pro export). */
export function tabToAlphaTex(content: TabContent, o: TexOptions): string {
  const bars = content.measures.map(
    (m) => (m.timeSignature ? `\\ts (${m.timeSignature[0]} ${m.timeSignature[1]}) ` : '') + m.beats.map((b) => beatTex(b, o.tuning.length)).join(' '),
  )
  return [
    `\\title ${quote(o.title)}`,
    `\\tempo ${o.tempo}`,
    '.',
    `\\track ${quote('Track 1')}`,
    ...(o.program !== undefined ? [`\\instrument ${o.program}`] : []),
    '\\staff {tabs}',
    `\\tuning (${o.tuning.map(midiToTex).join(' ')})`,
    `\\ts (${o.timeSignature[0]} ${o.timeSignature[1]})`,
    bars.join(' |\n') + ' |',
  ].join('\n')
}

export interface MelodyTexOptions {
  title: string
  tempo: number
  timeSignature: [number, number]
  key: string
  /** 'bass' uses the bass clef; guitar-family sheets use treble clef written an octave above sounding pitch. */
  clef: 'treble8' | 'treble' | 'bass'
  program?: number
}

function melodyNoteTex(n: MelodyBeat['notes'][number], key: string) {
  const fx = [n.tie ? 't' : '', n.finger !== undefined ? `lf ${n.finger}` : ''].filter(Boolean)
  return `${texPitch(n.midi, n.spelling ?? defaultSpelling(key))}${fx.length ? `{${fx.join(' ')}}` : ''}`
}

function melodyBeatTex(beat: MelodyBeat, key: string) {
  const notes = beat.notes.map((n) => melodyNoteTex(n, key))
  const head = !notes.length ? 'r' : notes.length === 1 ? notes[0] : `(${notes.join(' ')})`
  return `${head}.${beat.duration}${beatFx(beat)}`
}

/** Rests filling a whole measure (for a second voice that is silent in that measure). */
function measureRests(ts: [number, number]) {
  const values: [number, string][] = [[3840, 'r.1'], [2880, 'r.2 {d}'], [1920, 'r.2'], [1440, 'r.4 {d}'], [960, 'r.4'], [720, 'r.8 {d}'], [480, 'r.8'], [240, 'r.16'], [120, 'r.32']]
  let left = measureCapacity(ts)
  const out: string[] = []
  for (const [ticks, tex] of values) while (left >= ticks) (out.push(tex), (left -= ticks))
  return out.join(' ')
}

/** Standard notation (and playback) for melody content. */
export function melodyToAlphaTex(content: MelodyContent, o: MelodyTexOptions): string {
  const bars = content.measures.map(
    (m) => (m.timeSignature ? `\\ts (${m.timeSignature[0]} ${m.timeSignature[1]}) ` : '') + m.beats.map((b) => melodyBeatTex(b, o.key)).join(' '),
  )
  // A second voice (classical guitar bass): both voices are written out bar by bar.
  let ts = o.timeSignature
  const second = content.measures.some((m) => m.voice2?.length)
    ? content.measures.map((m) => {
        if (m.timeSignature) ts = m.timeSignature
        return m.voice2?.length ? m.voice2.map((b) => melodyBeatTex(b, o.key)).join(' ') : measureRests(ts)
      })
    : null
  return [
    `\\title ${quote(o.title)}`,
    `\\tempo ${o.tempo}`,
    `\\track ${quote('Track 1')}`,
    ...(o.program !== undefined ? [`\\instrument ${o.program}`] : []),
    '\\staff {score}',
    `\\clef ${o.clef === 'bass' ? 'F4' : 'G2'}`,
    // Guitar and bass music is written an octave above how it sounds.
    ...(o.clef === 'treble8' || o.clef === 'bass' ? ['\\displaytranspose 12'] : []),
    `\\ks ${KEY_SIGNATURE_NAMES[keyTonic(o.key)]}`,
    `\\ts (${o.timeSignature[0]} ${o.timeSignature[1]})`,
    ...(second ? ['\\voice', bars.join(' |\n') + ' |', '\\voice', second.join(' |\n') + ' |'] : [bars.join(' |\n') + ' |']),
  ].join('\n')
}
