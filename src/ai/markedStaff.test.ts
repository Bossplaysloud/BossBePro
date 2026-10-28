import { describe, expect, it } from 'vitest'
import { eventLength, keyAlter, keyName, staffToRecognition, type StaffAnswer, type StaffEventAnswer, type StaffLayout } from './markedStaff'
import { toImportedSheet } from './toContent'

const layout = (n: number): StaffLayout => ({ measures: Array.from({ length: n }, (_, i) => ({ no: i + 1, staff: 0, x0: 0, x1: 100 })) })
const note = (position: string, more: Partial<StaffEventAnswer['notes'][number]> = {}) => ({ position, accidental: 'none' as const, tie: false, string: null, finger: null, ...more })
const ev = (value: StaffEventAnswer['value'], notes: StaffEventAnswer['notes'] = [], more: Partial<StaffEventAnswer> = {}): StaffEventAnswer => ({ rest: !notes.length, notes, value, dots: 0, tuplet: 0, grace: false, ...more })
const answer = (ts: string, keySignature: number, measures: StaffEventAnswer[][][]): StaffAnswer => ({
  title: null, tempo: null, timeSignature: ts, keySignature, key: null, warnings: [],
  measures: measures.map((voices, i) => ({ measure: i + 1, keySignature: null, timeSignature: null, voices: voices.map((events, v) => ({ voice: v + 1, events })) })),
})
const midis = (r: ReturnType<typeof staffToRecognition>, m: number) => r.measures[m].beats.map((b) => b.notes?.map((n) => n.midi) ?? [])

describe('key signatures', () => {
  it('alters the right letters', () => {
    expect(['F', 'C', 'G'].map((l) => keyAlter(2, l))).toEqual([1, 1, 0])
    expect(['B', 'E', 'A'].map((l) => keyAlter(-2, l))).toEqual([-1, -1, 0])
    expect([keyName(-2), keyName(0), keyName(4)]).toEqual(['Bb', 'C', 'E'])
  })
})

describe('note values', () => {
  it('reads dots and tuplets, including duplets in compound time', () => {
    expect(eventLength({ value: '4', dots: 2, tuplet: 0 }, [4, 4])).toBe(14)
    expect(eventLength({ value: '8', dots: 0, tuplet: 3 }, [4, 4])).toBeCloseTo(8 / 3)
    expect(eventLength({ value: '8', dots: 0, tuplet: 2 }, [6, 8])).toBe(6) // a duplet eighth = a dotted eighth
    expect(eventLength({ value: '16', dots: 0, tuplet: 5 }, [4, 4])).toBeCloseTo(1.6)
  })
})

describe('the rules of notation', () => {
  it('applies the key signature, then accidentals for the rest of the measure on that position only', () => {
    // G major (1 sharp), 3/4: F5, F♮5, F5 (still natural), F4 (other octave: sharp again)
    const r = staffToRecognition(answer('3/4', 1, [[[ev('8', [note('F5')]), ev('8', [note('F5', { accidental: 'natural' })]), ev('4', [note('F5')]), ev('4', [note('F4')])]], [[ev('2', [note('F5')], { dots: 1 })]]]), layout(2))
    expect(midis(r, 0)).toEqual([[78], [77], [77], [66]])
    expect(midis(r, 1)).toEqual([[78]]) // the bar line cancels the natural
  })

  it('keeps an accidental through a tie over the bar line, and marks the tied note', () => {
    const r = staffToRecognition(answer('2/4', 0, [[[ev('4', [note('E4')]), ev('4', [note('G4', { accidental: 'sharp', tie: true })])]], [[ev('4', [note('G4')]), ev('4', [note('G4')])]]]), layout(2))
    expect(midis(r, 1)).toEqual([[68], [67]])
    expect(r.measures[1].beats[0].notes![0].tie).toBe(true)
    expect(r.measures[1].beats[1].notes![0].tie).toBeUndefined()
  })

  it('reads chords lowest first, a second voice padded with rests, and fingering', () => {
    const r = staffToRecognition(answer('3/4', 0, [[
      [ev('4', [note('E5', { finger: 0 }), note('C5', { string: 2, finger: 1 })]), ev('4', [note('D5')]), ev('4', [note('E5')])],
      [ev('2', [note('A3')])],
    ]]), layout(1))
    expect(r.measures[0].beats[0].notes!.map((n) => [n.midi, n.string, n.finger])).toEqual([[72, 2, 1], [76, undefined, 0]])
    expect(r.measures[0].voice2!.map((b) => [b.duration, b.notes?.length ?? 0])).toEqual([['2', 1], ['4', 0]])
  })

  it('stores values the editor cannot hold as tied notes, and a whole rest as a full measure', () => {
    const r = staffToRecognition(answer('3/4', 0, [[[ev('4', [note('A4')], { dots: 2 }), ev('16', [note('B4')])]], [[ev('1')]]]), layout(2))
    expect(r.measures[0].beats.map((b) => [b.duration, b.dotted, b.notes?.[0]?.tie ?? false])).toEqual([['4', true, false], ['16', false, true], ['16', false, false]])
    expect(r.measures[1].beats.map((b) => [b.duration, b.dotted])).toEqual([['2', true]])
  })

  it('keeps grace notes as grace notes that take no time', () => {
    const r = staffToRecognition(answer('2/4', 0, [[[ev('8', [note('D5')], { grace: true }), ev('4', [note('C5')]), ev('4', [note('B4')])]]]), layout(1))
    expect(r.measures[0].beats.map((b) => [b.grace ?? false, b.notes?.[0]?.midi])).toEqual([[true, 74], [false, 72], [false, 71]])
    expect(toImportedSheet(r, 'x').warnings).toEqual([])
  })

  it('imports as a guitar staff sheet, an octave below the written notes, with both voices', () => {
    const r = staffToRecognition(answer('6/8', 1, [[
      [ev('8', [note('B4')], { tuplet: 2 }), ev('8', [note('D5')], { tuplet: 2 }), ev('8', [note('B4')], { tuplet: 2 }), ev('8', [note('D5')], { tuplet: 2 })],
      [ev('4', [note('E3')], { dots: 1 }), ev('4', [note('B3')], { dots: 1 })],
    ]]), layout(1))
    const sheet = toImportedSheet(r, 'x')
    expect(sheet.type).toBe('staff')
    expect(sheet.key).toBe('G')
    expect(sheet.timeSignature).toEqual([6, 8])
    const m = (sheet.content as { measures: { beats: { duration: number; dotted?: boolean; notes: { midi: number }[] }[]; voice2?: unknown[] }[] }).measures[0]
    expect(m.beats.map((b) => [b.duration, b.dotted, b.notes[0].midi])).toEqual([[8, true, 59], [8, true, 62], [8, true, 59], [8, true, 62]])
    expect(m.voice2).toHaveLength(2)
    expect(sheet.warnings).toEqual([])
  })
})

describe('lead sheets', () => {
  it('keeps chord symbols, repeats the previous measure for a ⁒ sign, and joins answers per line', async () => {
    const { mergeStaffAnswers } = await import('./markedStaff')
    const line1 = answer('4/4', -4, [[[ev('2', [], { rest: true }), ev('8', [note('C5')], { chord: 'Ab' }), ev('8', [note('D5')]), ev('4', [note('E5')])]]])
    const line2: StaffAnswer = { ...answer('4/4', -4, []), keySignature: 0, timeSignature: null, measures: [{ measure: 2, keySignature: null, timeSignature: null, repeatPrevious: true, voices: [] }] }
    const r = staffToRecognition(mergeStaffAnswers([line1, line2]), layout(2))
    expect(r.measures[0].beats.map((b) => b.chord)).toEqual([null, 'Ab', null, null])
    // Ab major: D and E are flat
    expect(r.measures[0].beats.slice(1).map((b) => b.notes![0].midi)).toEqual([72, 73, 75])
    expect(r.measures[1].beats.map((b) => b.notes?.[0]?.midi ?? null)).toEqual([null, 72, 73, 75])
    const sheet = toImportedSheet(r, 'Donna Lee')
    expect(sheet.key).toBe('Ab')
    expect(sheet.warnings).toEqual([])
  })
})

describe('sextuplets', () => {
  it('keeps a sextuplet as six tuplet beats instead of tied pieces', () => {
    const six = Array.from({ length: 6 }, () => ev('16', [note('A4')], { tuplet: 6 }))
    const r = staffToRecognition(answer('2/4', 0, [[[...six, ev('4', [note('B4')])]]]), layout(1))
    expect(r.measures[0].beats.map((b) => [b.duration, b.tuplet])).toEqual([...six.map(() => ['16', 6]), ['4', 0]])
    const s = toImportedSheet(r, 'x')
    expect((s.content as { measures: { beats: { tuplet?: number }[] }[] }).measures[0].beats.map((b) => b.tuplet ?? 0)).toEqual([6, 6, 6, 6, 6, 6, 0])
    expect(s.warnings).toEqual([])
  })
})
