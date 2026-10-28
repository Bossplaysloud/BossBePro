import { describe, expect, it } from 'vitest'
import { emptyChart, type Recognition, type RecognizedBeat } from './schema'
import { degreeToPitch, pitchToMidi, toImportedSheet } from './toContent'

const beat = (over: Partial<RecognizedBeat>): RecognizedBeat => ({
  duration: '4', dotted: false, triplet: false, chord: null, lyric: null, tab: [], pitch: null, degree: null, tie: false, ...over,
})
const base: Recognition = {
  notation: 'tab', title: null, strings: null, tuning: null, key: null, timeSignature: null, tempo: null, capo: null,
  measures: [], chart: emptyChart(), chordChart: null, warnings: [],
}

describe('toImportedSheet', () => {
  it('builds TAB content with techniques and tuning', () => {
    const r: Recognition = {
      ...base,
      title: 'Riff', strings: 6, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'], timeSignature: '3/4', tempo: 90,
      measures: [{
        timeSignature: null,
        beats: [
          beat({ tab: [{ string: 3, fret: 5, dead: false, tie: false, techniques: ['hammer'] }], chord: 'ａｍ' }),
          beat({ duration: '8', tab: [{ string: 3, fret: 7, dead: false, tie: false, techniques: ['bend', 'release', 'vibrato'] }] }),
          beat({ tab: [{ string: 6, fret: null, dead: true, tie: false, techniques: [] }, { string: 9, fret: 1, dead: false, tie: false, techniques: [] }] }),
        ],
      }],
    }
    const s = toImportedSheet(r, 'x')
    expect(s).toMatchObject({ type: 'tab', title: 'Riff', instrument: 'guitar', timeSignature: [3, 4], tempo: 90 })
    expect(s.tuning).toEqual([64, 59, 55, 50, 45, 38])
    const beats = (s.content as { measures: { beats: { notes: unknown[]; chord?: string }[] }[] }).measures[0].beats
    expect(beats[0]).toMatchObject({ chord: 'Am', notes: [{ string: 3, fret: 5, legato: 'h' }] })
    expect(beats[1].notes[0]).toEqual({ string: 3, fret: 7, bend: 1, release: true, vibrato: true })
    expect(beats[2].notes).toEqual([{ string: 6, fret: 0, dead: true }]) // string 9 dropped
  })

  it('reads staff pitches as written (guitar sounds an octave lower)', () => {
    const s = toImportedSheet({ ...base, notation: 'staff', key: 'G', measures: [{ timeSignature: null, beats: [beat({ pitch: 'G4' }), beat({ pitch: 'F#4', tie: false }), beat({ pitch: null })] }] }, 'x')
    const notes = (s.content as { measures: { beats: { notes: { midi: number }[] }[] }[] }).measures[0].beats.map((b) => b.notes[0]?.midi)
    expect(s.type).toBe('staff')
    expect(notes).toEqual([55, 54, undefined])
  })

  it('reads numbered degrees relative to the key', () => {
    expect(degreeToPitch('1', 55)).toBe(55)
    expect(degreeToPitch("5'", 55)).toBe(74)
    expect(degreeToPitch('6,', 55)).toBe(52)
    expect(degreeToPitch('#4', 55)).toBe(61)
    expect(degreeToPitch('0', 55)).toBeNull()
    const s = toImportedSheet({ ...base, notation: 'numbered', key: 'G', measures: [{ timeSignature: '2/4', beats: [beat({ degree: '1', lyric: '一' }), beat({ degree: '5' })] }] }, 'x')
    const m = (s.content as { measures: { timeSignature?: number[]; beats: { notes: { midi: number }[]; lyric?: string }[] }[] }).measures[0]
    expect(m.timeSignature).toEqual([2, 4])
    expect(m.beats.map((b) => b.notes[0].midi)).toEqual([55, 62])
    expect(m.beats[0].lyric).toBe('一')
  })

  it('builds chord charts and infers bass and ukulele', () => {
    const s = toImportedSheet({ ...base, notation: 'chord', chordChart: '[C]我們 [G]的', capo: 2 }, 'Song')
    expect(s).toMatchObject({ type: 'chord', title: 'Song', content: { kind: 'chords', text: '[C]我們 [G]的', capo: 2 } })
    expect(toImportedSheet({ ...base, strings: 4, tuning: ['E1', 'A1', 'D2', 'G2'] }, 'x').instrument).toBe('bass')
    expect(toImportedSheet({ ...base, strings: 4, tuning: ['G4', 'C4', 'E4', 'A4'] }, 'x').instrument).toBe('ukulele')
    expect(pitchToMidi('E♭4')).toBe(63)
    expect(() => toImportedSheet({ ...base, notation: 'unknown' }, 'x')).toThrow()
  })
})

describe('tuplets', () => {
  it('imports sextuplets, and triplets from the older flag', () => {
    const six = Array.from({ length: 6 }, () => beat({ duration: '16', tuplet: 6, tab: [{ string: 1, fret: 5, dead: false, tie: false, techniques: [] }] }))
    const three = Array.from({ length: 3 }, () => beat({ duration: '8', triplet: true, tab: [{ string: 2, fret: 3, dead: false, tie: false, techniques: [] }] }))
    const s = toImportedSheet({ ...base, strings: 6, timeSignature: '2/4', measures: [{ timeSignature: null, beats: [...six, ...three] }] }, 'x')
    const beats = (s.content as { measures: { beats: { tuplet?: number }[] }[] }).measures[0].beats
    expect(beats.map((b) => b.tuplet)).toEqual([6, 6, 6, 6, 6, 6, 3, 3, 3])
    expect(s.warnings).toEqual([])
  })
})

describe('techniques', () => {
  it('reads tapping from the general technique list (not on a tied note)', () => {
    const s = toImportedSheet({ ...base, strings: 6, measures: [{ timeSignature: null, beats: [beat({ duration: '2', tab: [{ string: 1, fret: 12, dead: false, tie: false, techniques: ['tap'] }] }), beat({ duration: '2', tab: [{ string: 1, fret: 12, dead: false, tie: true, techniques: ['tap'] }] })] }] }, 'x')
    const notes = (s.content as { measures: { beats: { notes: { tap?: boolean }[] }[] }[] }).measures[0].beats.map((b) => !!b.notes[0].tap)
    expect(notes).toEqual([true, false])
  })
})

describe('schema', () => {
  it('asks for a tuplet number and keeps it through the Claude form', async () => {
    const { CLAUDE_SCHEMA, RECOGNITION_SCHEMA, restoreNulls, tupletOf } = await import('./schema')
    const beatSchema = (s: unknown) => (s as { properties: { measures: { items: { properties: { beats: { items: { properties: Record<string, { type: unknown }>; required: string[] } } } } } } }).properties.measures.items.properties.beats.items
    expect(beatSchema(CLAUDE_SCHEMA).properties.tuplet.type).toBe('integer')
    expect(beatSchema(CLAUDE_SCHEMA).required).toContain('tuplet')
    const back = restoreNulls({ measures: [{ timeSignature: '', beats: [{ ...beat({ duration: '16', tuplet: 6 }), chord: '', x: -1 }] }] }, RECOGNITION_SCHEMA) as Recognition
    expect(back.measures[0].beats[0]).toMatchObject({ tuplet: 6, chord: null, x: null })
    expect([tupletOf({ tuplet: 6 }), tupletOf({ triplet: true }), tupletOf({ tuplet: 0, triplet: true }), tupletOf({})]).toEqual([6, 3, 0, 0])
  })
})
