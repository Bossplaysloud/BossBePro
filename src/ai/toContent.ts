// Turns an AI transcription into sheet fields and BePro content.

import type { SheetType } from '../db/db'
import { chartTextFromSections, cleanLabel, emptyChordChart, formatPattern, type ChartMeta, type ChordChartContent } from '../music/chordChart'
import { keyFromChord, keyTonic, transposeKey } from '../music/chords'
import { defaultTuning, parseNote, type InstrumentId } from '../music/instruments'
import { numberedBase, type MelodyContent, type MelodyNote } from '../music/melody'
import { emptyMeasure, TUPLETS, uid, type Beat, type Duration, type Measure, type Tuplet } from '../music/rhythm'
import type { TabContent, TabNote } from '../music/tab'
import { normalizeChordName } from '../music/tidy'
import { checkMeasures } from './rhythmFix'
import { tupletOf, type Recognition, type RecognizedBeat, type TechniqueName } from './schema'

export interface ImportedSheet {
  type: SheetType
  title: string
  instrument: InstrumentId
  tuning: number[] // string 1 (highest) first
  timeSignature: [number, number]
  key: string
  tempo: number
  content: TabContent | MelodyContent | ChordChartContent
  warnings: string[]
}

const KEY_RE = /^[A-G][#b]?m?$/
const MAJOR = [0, 2, 4, 5, 7, 9, 11]

function parseTs(text: string | null | undefined): [number, number] | null {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(text ?? '')
  if (!m) return null
  const ts: [number, number] = [Number(m[1]), Number(m[2])]
  return ts[0] >= 1 && [2, 4, 8, 16].includes(ts[1]) ? ts : null
}

/** "F#4", "Bb3", "E♭4" → MIDI. */
export function pitchToMidi(text: string | null): number | null {
  if (!text) return null
  return parseNote(text.replace('♯', '#').replace('♭', 'b').trim())
}

function inferInstrument(strings: number, tuning: number[] | null): InstrumentId {
  if (tuning?.length) {
    const low = Math.min(...tuning)
    if (low < 36) return 'bass' // below C2: bass range
    if (strings === 4 && low >= 55) return 'ukulele'
    return 'guitar'
  }
  if (strings === 4 || strings === 5) return 'bass'
  return 'guitar'
}

function baseBeat(b: RecognizedBeat): Omit<Beat, 'notes'> {
  const duration = Number(b.duration) as Duration
  return {
    id: uid(),
    duration: [1, 2, 4, 8, 16, 32].includes(duration) ? duration : 4,
    ...(b.dotted ? { dotted: true } : {}),
    ...((TUPLETS as number[]).includes(tupletOf(b)) ? { tuplet: tupletOf(b) as Tuplet } : {}),
    ...(b.grace ? { grace: true } : {}),
    // Common spelling variants (full-width, ♯, lowercase…) are fixed rather than dropped.
    ...(b.chord && normalizeChordName(b.chord) ? { chord: normalizeChordName(b.chord)! } : {}),
    ...(b.lyric?.trim() ? { lyric: b.lyric.trim() } : {}),
  }
}

function tabNote(n: Recognition['measures'][number]['beats'][number]['tab'][number], strings: number): TabNote | null {
  if (n.string < 1 || n.string > strings) return null
  if (n.dead || n.fret === null) return { string: n.string, fret: 0, dead: true }
  const has = (t: TechniqueName) => n.techniques.includes(t)
  const note: TabNote = { string: n.string, fret: Math.max(0, Math.min(36, n.fret)) }
  if (n.tie) note.tie = true
  if (has('hammer')) note.legato = 'h'
  else if (has('pull')) note.legato = 'p'
  if (has('slide')) note.slide = 'to'
  else if (has('slideIn')) note.slide = 'inBelow'
  else if (has('slideOut')) note.slide = 'outDown'
  if (has('bend')) note.bend = n.bend ?? 1
  if (has('bend') && has('release')) note.release = true
  if (has('harmonic')) note.harmonic = n.harmonic ?? 'natural'
  if ((n.tap || has('tap')) && !n.tie) note.tap = true
  if (has('palmMute')) note.palmMute = true
  if (has('vibrato')) note.vibrato = true
  if (has('letRing')) note.letRing = true
  if (has('ghost')) note.ghost = true
  return note
}

/** Numbered-notation degree ("#4", "1'", "6,", "0") → MIDI relative to "1" = base; null for rests. */
export function degreeToPitch(text: string | null, base: number): number | null {
  const m = /^\s*([#b♯♭]?)([0-7])(['’]*)([,，.]*)\s*$/.exec(text ?? '')
  if (!m || m[2] === '0') return null
  const acc = m[1] === '#' || m[1] === '♯' ? 1 : m[1] ? -1 : 0
  return base + MAJOR[Number(m[2]) - 1] + acc + 12 * (m[3].length - m[4].length)
}

export function toImportedSheet(r: Recognition, fallbackTitle: string): ImportedSheet {
  if (r.notation === 'unknown') throw new Error('unknown notation')
  const warnings = [...(r.warnings ?? [])]
  const tuningIn = r.tuning?.map(pitchToMidi).filter((m): m is number => m !== null) ?? null
  const maxString = Math.max(0, ...r.measures.flatMap((m) => m.beats.flatMap((b) => b.tab.map((n) => n.string))))
  let strings = r.strings ?? tuningIn?.length ?? (maxString || 6)
  strings = Math.max(4, Math.min(8, strings))
  const instrument = inferInstrument(strings, tuningIn && tuningIn.length === strings ? tuningIn : null)
  const tuning = tuningIn && tuningIn.length === strings ? [...tuningIn].reverse() : defaultTuning(instrument, strings)
  const timeSignature = parseTs(r.timeSignature) ?? [4, 4]
  const key = r.key && KEY_RE.test(r.key.trim()) ? r.key.trim() : 'C'
  const tempo = r.tempo && r.tempo >= 20 && r.tempo <= 300 ? Math.round(r.tempo) : 100
  const title = r.title?.trim() || fallbackTitle

  // Columns split in two, incomplete tuplets and measures of the wrong length are fixed first.
  const signatures: [number, number][] = []
  r.measures.reduce<[number, number]>((ts, m) => {
    const next = parseTs(m.timeSignature) ?? ts
    signatures.push(next)
    return next
  }, timeSignature)
  const checked = r.notation === 'chord' ? null : checkMeasures(r.measures, (i) => signatures[i], r.notation === 'tab')
  if (checked) {
    if (checked.merged) warnings.push(`columns:${checked.merged}`)
    if (checked.tuplets) warnings.push(`tuplets:${checked.tuplets}`)
    if (checked.reflowed.length) warnings.push(`reflowed:${checked.reflowed.join(', ')}`)
    if (checked.wrong.length) warnings.push(`lengthWrong:${checked.wrong.join(', ')}`)
  }
  const source = checked?.measures ?? r.measures

  const measuresOf = <N,>(noteFn: (b: RecognizedBeat) => N[]): Measure<N & { tie?: boolean }>[] => {
    let ts = timeSignature
    const out = source.map((m) => {
      const change = parseTs(m.timeSignature)
      if (change) ts = change
      const beats = m.beats.map((b) => ({ ...baseBeat(b), notes: noteFn(b) })) as Beat<N & { tie?: boolean }>[]
      const voice2 = m.voice2?.map((b) => ({ ...baseBeat(b), notes: noteFn(b) })) as Beat<N & { tie?: boolean }>[] | undefined
      return { id: uid(), ...(change ? { timeSignature: change } : {}), beats: beats.length ? beats : (emptyMeasure(ts).beats as Beat<N & { tie?: boolean }>[]), ...(voice2?.length ? { voice2 } : {}) }
    })
    return out.length ? out : [emptyMeasure(timeSignature) as Measure<N & { tie?: boolean }>]
  }

  const common = { title, instrument, tuning, timeSignature, key, tempo, warnings }

  if (r.notation === 'chord') return toChordSheet(r, common)

  if (r.notation === 'tab') {
    const content: TabContent = {
      kind: 'tab',
      version: 1,
      measures: measuresOf((b) => b.tab.map((n) => tabNote(n, strings)).filter((n): n is TabNote => n !== null)),
    }
    return { ...common, type: 'tab', content }
  }

  // Staff and numbered notation share melody content (sounding pitch).
  // Guitar and bass music is written an octave above how it sounds.
  const writtenOffset = instrument === 'ukulele' ? 0 : -12
  const base = numberedBase(tuning, key)
  let dropped = 0
  const content: MelodyContent = {
    kind: 'melody',
    version: 1,
    measures: measuresOf<MelodyNote>((b) => {
      // Staff read by the app's rules: chords, ties and fingering are already worked out.
      if (b.notes) return b.notes.map((n) => ({ ...n, midi: n.midi + writtenOffset }))
      const midi = r.notation === 'staff' ? pitchToMidi(b.pitch) : degreeToPitch(b.degree, base)
      if (midi === null) {
        if ((r.notation === 'staff' ? b.pitch : b.degree && b.degree.trim() !== '0') && !b.tie) dropped++
        return []
      }
      const sounding = r.notation === 'staff' ? midi + writtenOffset : midi
      return [{ midi: sounding, ...(b.tie ? { tie: true } : {}), ...(/b|♭/.test((b.pitch ?? b.degree ?? '').slice(0, 2)) ? { spelling: 'flat' as const } : {}) }]
    }),
  }
  if (dropped) warnings.push(`unreadable:${dropped}`)
  return { ...common, type: r.notation === 'staff' ? 'staff' : 'numbered', content }
}

/** A key name from the AI, spelled as in the app's key list ("G#" → "Ab"), or null. */
function cleanKey(raw: string | null | undefined): string | null {
  const k = raw?.normalize('NFKC').trim().replace('♯', '#').replace('♭', 'b').replace(/major$/i, '').replace(/minor$/i, 'm').trim()
  if (!k || !/^[A-Ga-g][#b]?m?$/.test(k)) return null
  return transposeKey(k[0].toUpperCase() + k.slice(1), 0)
}

function toChordSheet(r: Recognition, common: Omit<ImportedSheet, 'type' | 'content'>): ImportedSheet {
  const chart = r.chart
  const sections = chart?.sections ?? []
  const firstChord = sections.flatMap((s) => s.lines.flatMap((l) => l.bars.flatMap((b) => b.segments.flatMap((g) => (g.chord ? [g.chord] : [])))))[0]
  // The sheet key is the key the chords are written in; the song's original key may differ (→ capo).
  const written = cleanKey(chart?.writtenKey) ?? (firstChord ? keyFromChord(normalizeChordName(firstChord) ?? firstChord) : null) ?? cleanKey(r.key) ?? 'C'
  const original = cleanKey(chart?.originalKey) ?? cleanKey(r.key)
  let capo = r.capo && r.capo >= 1 && r.capo <= 11 ? r.capo : undefined
  if (!capo && original && original !== written) {
    const diff = (((keyTonic(original) - keyTonic(written)) % 12) + 12) % 12
    if (diff >= 1 && diff <= 9) capo = diff
  }
  const header = (chart?.patterns ?? [])
    .filter((p) => p.beats?.some((b) => b.symbols.length))
    .map((p) => {
      const beats = p.beats.filter((b) => b.symbols.length)
      const text = formatPattern(
        beats.map((b) => ({ symbols: fitBeat(b.symbols.map((s) => ({ text: s.text.trim() || '-', duration: Number(s.duration) || 4, dotted: s.dotted }))) })),
        beats.map((b) => b.barAfter),
      )
      return `[${cleanLabel(p.label) || '節奏'}] ${text}`
    })
  const body = sections.length
    ? chartTextFromSections(sections, normalizeChordName)
    : r.chordChart?.trim() || r.measures.map((m) => m.beats.map((b) => `${b.chord ? `[${b.chord}]` : ''}${b.lyric ?? ''}`).join('')).join('\n')
  const meta: ChartMeta = {
    ...(original ? { originalKey: original } : {}),
    ...(cleanKey(chart?.maleKey) ? { maleKey: cleanKey(chart?.maleKey)! } : {}),
    ...(cleanKey(chart?.femaleKey) ? { femaleKey: cleanKey(chart?.femaleKey)! } : {}),
    ...(r.tempo ? { tempo: Math.round(r.tempo) } : {}),
    ...(parseTs(r.timeSignature) ? { timeSignature: parseTs(r.timeSignature)!.join('/') } : {}),
  }
  const content: ChordChartContent = {
    ...emptyChordChart(),
    text: [...header, ...(header.length ? [''] : []), body].join('\n').trim(),
    ...(capo ? { capo } : {}),
    ...(Object.keys(meta).length ? { meta } : {}),
  }
  return { ...common, key: written, type: 'chord', content }
}

/**
 * Makes one beat of a rhythm pattern add up to exactly one beat. When the AI's values do not,
 * the symbols share the beat evenly (4 symbols → sixteenths); 3 or 6 symbols become a tuplet.
 */
export function fitBeat<S extends { duration: number; dotted?: boolean }>(symbols: S[]): S[] {
  const total = symbols.reduce((t, s) => t + (4 / s.duration) * (s.dotted ? 1.5 : 1), 0)
  if (Math.abs(total - 1) < 0.01) return symbols
  const n = symbols.length
  const even = n === 3 ? 8 : n === 6 ? 16 : [1, 2, 4, 8].includes(n) ? 4 * n : null
  return even ? symbols.map((s) => ({ ...s, duration: even, dotted: false })) : symbols
}
