import { describe, expect, it } from 'vitest'
import { tupletOf, type RecognizedBeat } from './schema'
import type { ColumnRhythm, Detection, Staff } from '../lib/tabDetect'
import { buildMarkedPrompt, layoutFromDetection, linkNotes, markedToRecognition, mergeMarkedAnswers, readNote, subLayout, systemGroups, type MarkedAnswer } from './markedTab'
import { toImportedSheet } from './toContent'

/** Gravity, measure 1 (6/8) and measure 2, as the detector measures them. */
function detection(): Detection {
  const lines = [100, 110, 120, 130, 140, 150]
  const box = (x: number, string: number) => ({ x0: x - 3, y0: lines[string - 1] - 4, x1: x + 3, y1: lines[string - 1] + 4 })
  // [x, strings] per column: chord, bass, 3/2 (H), 4, bass, 3/4 (H), 5 | 3/5, 4, bass
  const cols: [number, number[]][] = [[60, [2, 3, 4, 6]], [120, [6]], [160, [2, 3]], [180, [3]], [220, [6]], [250, [2, 3]], [270, [3]], [330, [2, 3]], [350, [3]], [400, [6]]]
  const staff: Staff = {
    kind: 'tab', lines, spacing: 10, x0: 20, x1: 500, barLines: [20, 300, 500],
    columns: cols.map(([x]) => x),
    numbers: cols.flatMap(([x, strings], column) => strings.map((string) => ({ box: box(x, string), string, column, measure: x < 300 ? 1 : 2, offLine: 0 }))),
  }
  return { width: 600, height: 200, staves: [staff] }
}

const answer = (measures: MarkedAnswer['measures']): MarkedAnswer => ({
  title: 'Gravity', tempo: 61, timeSignature: '6/8', key: 'Bb', capo: 3, tuning: null, warnings: [],
  columns: [
    { id: 1, notes: [{ string: 2, text: '3', technique: 'none' }, { string: 3, text: '4', technique: 'none' }, { string: 4, text: '5', technique: 'none' }, { string: 6, text: '3', technique: 'none' }] },
    { id: 2, notes: [{ string: 6, text: '3', technique: 'none' }] },
    { id: 3, notes: [{ string: 2, text: '3', technique: 'none' }, { string: 3, text: '2', technique: 'hammer' }] },
    { id: 4, notes: [{ string: 3, text: '4', technique: 'none' }] },
    { id: 5, notes: [{ string: 6, text: '3', technique: 'none' }] },
    { id: 6, notes: [{ string: 2, text: '3', technique: 'none' }, { string: 3, text: '4', technique: 'hammer' }] },
    { id: 7, notes: [{ string: 3, text: '5', technique: 'none' }] },
    { id: 8, notes: [{ string: 2, text: '3', technique: 'none' }, { string: 3, text: '5', technique: 'pull' }] },
    { id: 9, notes: [{ string: 3, text: '4', technique: 'none' }] },
    { id: 10, notes: [{ string: 6, text: '3', technique: 'none' }] },
  ],
  measures,
})

const ev = (type: 'column' | 'rest' | 'tie', column: number | null, duration: '4' | '8' | '16', dotted = false, triplet = false) => ({ type, column, duration, dotted, triplet })

describe('marked TAB', () => {
  const layout = layoutFromDetection(detection())!

  it('lays out measures and columns from the detection', () => {
    expect(layout.measures.map((m) => m.columns)).toEqual([[1, 2, 3, 4, 5, 6, 7], [8, 9, 10]])
    expect(layout.columns[0].boxes.map((b) => b.string)).toEqual([2, 3, 4, 6])
    const prompt = buildMarkedPrompt(layout, { language: 'en' })
    expect(prompt).toContain('c1: strings 2, 3, 4, 6')
    expect(prompt).toContain('m1: c1 c2 c3 c4 c5 c6 c7')
  })

  it('puts the notes on the measured strings, keeps ties, and accepts a full measure as read', () => {
    // m1: chord (quarter), then two groups of triplet eighths = 6/8
    const r = markedToRecognition(answer([
      { measure: 1, timeSignature: null, events: [ev('column', 1, '4'), ev('column', 2, '8', false, true), ev('column', 3, '8', false, true), ev('column', 4, '8', false, true), ev('column', 5, '8', false, true), ev('column', 6, '8', false, true), ev('column', 7, '8', false, true)] },
      { measure: 2, timeSignature: null, events: [ev('column', 8, '8'), ev('tie', null, '8'), ev('column', 9, '8'), ev('rest', null, '8'), ev('column', 10, '4')] },
    ]), layout)
    const [m1, m2] = r.measures
    expect(m1.beats[0].tab.map((n) => [n.string, n.fret])).toEqual([[2, 3], [3, 4], [4, 5], [6, 3]])
    // No arc was measured here: the AI's own "hammer" is not used.
    expect(m1.beats[2].tab.find((n) => n.string === 3)!.techniques).toEqual([])
    expect(m1.beats.map((b) => b.duration)).toEqual(['4', '8', '8', '8', '8', '8', '8'])
    expect(m2.beats.map((b) => b.tab.length && b.tab[0].tie)).toEqual([false, true, false, 0, false])
    expect(r.warnings).toEqual([])
    expect(r.capo).toBe(3)
  })

  it('puts a skipped column back and re-times a measure that does not add up', () => {
    const r = markedToRecognition(answer([
      { measure: 1, timeSignature: null, events: [ev('column', 1, '4'), ev('column', 3, '8'), ev('column', 4, '8'), ev('column', 5, '8'), ev('column', 6, '8'), ev('column', 7, '8')] },
      { measure: 2, timeSignature: null, events: [ev('column', 8, '4', true), ev('column', 9, '8'), ev('column', 10, '8'), ev('rest', null, '8')] },
    ]), layout)
    expect(r.measures[0].beats).toHaveLength(7)
    expect(r.measures[0].beats[1].tab[0]).toMatchObject({ string: 6, fret: 3 })
    const len = (b: (typeof r.measures)[number]['beats'][number]) => (32 / Number(b.duration)) * (b.dotted ? 1.5 : 1) * (b.triplet ? 2 / 3 : 1)
    expect(r.measures[0].beats.reduce((t, b) => t + len(b), 0)).toBe(24)
    expect(r.measures[1].beats.reduce((t, b) => t + len(b), 0)).toBe(24)
    expect(r.warnings).toEqual(['reflowed:1'])
  })
})

describe('arcs and slides', () => {
  const note = (string: number, fret: number, techniques: ('hammer' | 'pull' | 'slide' | 'vibrato')[] = []) => ({ string, fret, dead: false, tie: false, techniques: [...techniques] })
  const layoutWith = (links: Record<number, 'arc' | 'slide'>) => ({
    strings: 6,
    measures: [],
    columns: [1, 2, 3, 4].map((id) => ({ id, staff: 0, x: id * 10, boxes: [{ string: 3, box: { x0: 0, y0: 0, x1: 1, y1: 1 }, ...(links[id] ? { link: links[id], linkTo: id + 1 } : {}) }] })),
  })

  it('names the arc by the frets: higher = hammer-on, lower = pull-off, same = tie', () => {
    const seq = [{ column: 1, notes: [note(3, 2)] }, { column: 2, notes: [note(3, 4)] }, { column: 3, notes: [note(3, 2)] }, { column: 4, notes: [note(3, 2)] }]
    linkNotes(seq, layoutWith({ 1: 'arc', 2: 'arc', 3: 'arc' }))
    expect(seq.map((p) => p.notes[0].techniques)).toEqual([['hammer'], ['pull'], [], []])
    expect(seq[3].notes[0].tie).toBe(true)
  })

  it('takes slides from the stroke, ignores H/P the AI guessed without an arc, and keeps other techniques', () => {
    const seq = [{ column: 1, notes: [note(3, 5, ['vibrato'])] }, { column: 2, notes: [note(3, 7, ['pull'])] }, { column: 3, notes: [note(3, 5, ['slide'])] }, { column: 4, notes: [note(3, 9, ['hammer'])] }]
    linkNotes(seq, layoutWith({ 1: 'slide' }))
    expect(seq.map((p) => p.notes[0].techniques)).toEqual([['vibrato', 'slide'], [], [], []])
  })
})

describe('rhythm measured under the TAB', () => {
  it('uses the measured values, and turns the roomiest quarter into the missing half', () => {
    const q: ColumnRhythm = { duration: 4, dotted: false, triplet: false }
    const col = (id: number, x: number, rhythm: ColumnRhythm = q) => ({ id, staff: 0, x, rhythm, boxes: [{ string: 1, box: { x0: x - 2, y0: 0, x1: x + 2, y1: 4 } }] })
    // 4/4: m1 four quarters; m2 dotted quarter, eighth, then a "quarter" with lots of room (really a half)
    const layout = {
      strings: 6,
      columns: [col(1, 10), col(2, 30), col(3, 50), col(4, 70), col(5, 110, { duration: 4, dotted: true, triplet: false }), col(6, 140, { duration: 8, dotted: false, triplet: false }), col(7, 160), ],
      measures: [{ no: 1, columns: [1, 2, 3, 4], x0: 0, x1: 100 }, { no: 2, columns: [5, 6, 7], x0: 100, x1: 220 }],
    }
    const a: MarkedAnswer = {
      title: null, tempo: null, timeSignature: '4/4', key: null, capo: null, tuning: null, warnings: [],
      columns: [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, notes: [{ string: 1, text: String(id), technique: 'none' }] })),
      measures: [1, 2].map((measure) => ({ measure, timeSignature: null, events: layout.measures[measure - 1].columns.map((c) => ({ type: 'column' as const, column: c, duration: '16' as const, dotted: false, triplet: false })) })),
    }
    const r = markedToRecognition(a, layout)
    expect(r.measures[0].beats.map((b) => b.duration)).toEqual(['4', '4', '4', '4'])
    expect(r.measures[1].beats.map((b) => [b.duration, b.dotted])).toEqual([['4', true], ['8', false], ['2', false]])
    expect(r.warnings).toEqual([])
  })
})

describe('grace notes, brackets and lines of music', () => {
  const col = (id: number, x: number, more: Record<string, unknown> = {}) => ({ id, staff: 1, x, boxes: [{ string: 3, box: { x0: x - 2, y0: 0, x1: x + 2, y1: 4 } }], ...more })
  const answerFor = (events: [number, '4' | '8' | '16', boolean][]): MarkedAnswer => ({
    title: null, tempo: null, timeSignature: '6/8', key: null, capo: null, tuning: null, warnings: [],
    columns: events.map(([id]) => ({ id, notes: [{ string: 3, text: String(id + 1), technique: 'none' as const }] })),
    measures: [{ measure: 1, timeSignature: null, events: events.map(([column, duration, triplet]) => ({ type: 'column' as const, column, duration, dotted: false, triplet })) }],
  })

  it('takes no time for grace columns and lets the measured bracket decide triplets', () => {
    // 6/8: grace, then quarter; under a bracket an eighth + sixteenth (AI forgot the triplet); then a dotted quarter's worth of eighths
    const layout = {
      strings: 6,
      columns: [col(1, 10, { grace: true }), col(2, 14, { triplet: false }), col(3, 40, { triplet: true }), col(4, 50, { triplet: true }), col(5, 60, { triplet: false }), col(6, 70, { triplet: false }), col(7, 80, { triplet: false })],
      measures: [{ no: 1, columns: [1, 2, 3, 4, 5, 6, 7], x0: 0, x1: 100 }],
    }
    const r = markedToRecognition(answerFor([[1, '8', false], [2, '4', false], [3, '8', false], [4, '16', false], [5, '8', false], [6, '8', false], [7, '8', false]]), layout)
    const beats = r.measures[0].beats
    expect(beats[0].grace).toBe(true)
    expect(beats.map((b) => tupletOf(b))).toEqual([0, 0, 3, 3, 0, 0, 0])
    expect(r.warnings).toEqual([])
  })

  it('splits the page into lines of music and joins the answers', () => {
    const lines = (top: number) => [0, 1, 2, 3, 4, 5].map((i) => top + i * 10)
    const staff = (top: number): Staff => ({ kind: 'staff', lines: [0, 1, 2, 3, 4].map((i) => top + i * 6), spacing: 6, x0: 0, x1: 500, barLines: [], numbers: [], columns: [] })
    const tab = (top: number): Staff => ({ kind: 'tab', lines: lines(top), spacing: 10, x0: 0, x1: 500, barLines: [], numbers: [], columns: [] })
    const d: Detection = { width: 500, height: 600, staves: [staff(40), tab(110), staff(300), tab(370)] }
    const layout = { strings: 6, columns: [{ ...col(1, 50), staff: 1 }, { ...col(2, 60), staff: 3 }], measures: [{ no: 1, columns: [1], x0: 0, x1: 500 }, { no: 2, columns: [], x0: 0, x1: 500 }, { no: 3, columns: [2], x0: 0, x1: 500 }] }
    const groups = systemGroups(d, layout)
    expect(groups.map((g) => [g.columns, g.measures])).toEqual([[[1], [1, 2]], [[2], [3]]])
    expect(groups[0].y0).toBeLessThan(40)
    expect(groups[0].y1).toBeGreaterThan(160)
    expect(subLayout(layout, groups[1]).columns.map((c) => c.id)).toEqual([2])
    const merged = mergeMarkedAnswers([{ ...answerFor([[1, '4', false]]), title: 'A' }, { ...answerFor([[2, '4', false]]), title: null, tempo: 80 }])
    expect([merged.title, merged.tempo, merged.columns.length, merged.measures.length]).toEqual(['A', 80, 2, 2])
  })
})

describe('slides printed with an arc, and grace notes', () => {
  it('reads an arc as a slide when "sl." is printed, and leaves grace notes unmarked', () => {
    const note = (fret: number, techniques: ('slide' | 'hammer')[] = []) => ({ string: 1, fret, dead: false, tie: false, techniques: [...techniques] })
    const layout = { strings: 6, measures: [], columns: [1, 2, 3, 4].map((id) => ({ id, staff: 0, x: id * 10, boxes: [{ string: 1, box: { x0: 0, y0: 0, x1: 1, y1: 1 }, link: 'arc' as const, linkTo: id + 1 }] })) }
    const seq = [{ column: 1, notes: [note(5, ['slide'])] }, { column: 2, notes: [note(7)] }, { column: 3, notes: [note(3, ['hammer'])], grace: true }, { column: 4, notes: [note(5)] }]
    linkNotes(seq, layout)
    // the grace note keeps no H/P, but a grace note sliding in keeps its slide
    expect(seq.map((p) => p.notes[0].techniques)).toEqual([['slide'], ['pull'], [], []])
    const slid = [{ column: 3, notes: [note(5, ['slide'])], grace: true }, { column: 4, notes: [note(7)] }]
    linkNotes(slid, layout)
    expect(slid[0].notes[0].techniques).toEqual(['slide'])
  })
})

describe('short first and last measures', () => {
  it('re-times them when they are not a pickup (3 + 3 beats in 4/4)', () => {
    const col = (id: number, x: number) => ({ id, staff: 0, x, boxes: [{ string: 6, box: { x0: x - 2, y0: 0, x1: x + 2, y1: 4 } }] })
    const layout = { strings: 6, columns: [col(1, 10), col(2, 35), col(3, 60), col(4, 110), col(5, 135), col(6, 160)], measures: [{ no: 1, columns: [1, 2, 3], x0: 0, x1: 100 }, { no: 2, columns: [4, 5, 6], x0: 100, x1: 200 }] }
    const a: MarkedAnswer = {
      title: null, tempo: null, timeSignature: '4/4', key: null, capo: null, tuning: null, warnings: [],
      columns: [1, 2, 3, 4, 5, 6].map((id) => ({ id, notes: [{ string: 6, text: '0', technique: 'none' as const }] })),
      measures: [1, 2].map((measure) => ({ measure, timeSignature: null, events: layout.measures[measure - 1].columns.map((c) => ({ type: 'column' as const, column: c, duration: '4' as const, dotted: false, triplet: false })) })),
    }
    const r = markedToRecognition(a, layout)
    const len = (b: RecognizedBeat) => (32 / Number(b.duration)) * (b.dotted ? 1.5 : 1)
    expect(r.measures.map((m) => m.beats.reduce((t, b) => t + len(b), 0))).toEqual([32, 32])
    expect(r.warnings).toEqual(['reflowed:1, 2'])
  })
})

describe('bend, vibrato, harmonic and tapping marks', () => {
  it('reads the marks printed at a number', () => {
    expect(readNote(3, '7', 'none', ['bendHalf', 'release'])).toMatchObject({ fret: 7, techniques: ['bend', 'release'], bend: 0.5 })
    expect(readNote(3, '7', 'bend', ['bendFull'])).toMatchObject({ techniques: ['bend'], bend: 1 })
    expect(readNote(3, '7', 'none', ['bend'])!.bend).toBeUndefined()
    expect(readNote(1, '<12>', 'none', ['harmonic'])!.techniques).toEqual(['harmonic'])
    expect(readNote(1, '5', 'none', ['artificialHarmonic', 'vibrato'])).toMatchObject({ techniques: ['harmonic', 'vibrato'], harmonic: 'artificial' })
    expect(readNote(2, '12', 'none', ['tap'])).toMatchObject({ fret: 12, techniques: [], tap: true })
    expect(readNote(2, 'x', 'none', ['tap'])).toEqual({ string: 2, fret: null, dead: true, tie: false, techniques: [] })
  })

  it('maps them onto the TAB notes, while H / P still come only from measured arcs', () => {
    const layout = layoutFromDetection(detection())!
    const a = answer([
      { measure: 1, timeSignature: null, events: [ev('column', 1, '4'), ...[2, 3, 4, 5, 6, 7].map((c) => ev('column', c, '8', false, true))] },
      { measure: 2, timeSignature: null, events: [ev('column', 8, '8'), ev('tie', null, '8'), ev('column', 9, '8'), ev('rest', null, '8'), ev('column', 10, '4')] },
    ])
    a.columns[2].notes[1] = { string: 3, text: '2', technique: 'hammer', marks: ['bend1Half', 'vibrato'] }
    a.columns[3].notes[0] = { string: 3, text: '4', technique: 'none', marks: ['tap'] }
    a.columns[6].notes[0] = { string: 3, text: '5', technique: 'none', marks: ['artificialHarmonic'] }
    a.columns[7].notes[1] = { string: 3, text: '5', technique: 'none', marks: ['tap'] }
    const s = toImportedSheet(markedToRecognition(a, layout), 'x')
    const beats = (s.content as unknown as { measures: { beats: { notes: Record<string, unknown>[] }[] }[] }).measures.flatMap((m) => m.beats)
    const on = (b: number, string: number) => beats[b].notes.find((n) => n.string === string)
    expect(on(2, 3)).toEqual({ string: 3, fret: 2, bend: 1.5, vibrato: true })
    expect(on(3, 3)).toEqual({ string: 3, fret: 4, tap: true })
    expect(on(6, 3)).toEqual({ string: 3, fret: 5, harmonic: 'artificial' })
    expect(on(7, 3)).toEqual({ string: 3, fret: 5, tap: true })
    expect(on(8, 3)).toEqual({ string: 3, fret: 5, tie: true }) // the held note is not tapped again
  })
})

describe('sextuplets', () => {
  // 2/4: six sixteenths under a bracket in the staff above, then a quarter.
  const xs = [30, 40, 50, 60, 70, 80, 120]
  const d: Detection = {
    width: 200, height: 200,
    staves: [
      { kind: 'staff', lines: [40, 46, 52, 58, 64], spacing: 6, x0: 0, x1: 200, barLines: [], numbers: [], columns: [], tuplets: [[25, 85]] },
      {
        kind: 'tab', lines: [100, 110, 120, 130, 140, 150], spacing: 10, x0: 0, x1: 200, barLines: [0, 200], columns: xs,
        numbers: xs.map((x, column) => ({ box: { x0: x - 3, y0: 96, x1: x + 3, y1: 104 }, string: 1, column, measure: 1, offLine: 0 })),
      },
    ],
  }
  const answerWith = (tuplet: number): MarkedAnswer => ({
    title: null, tempo: null, timeSignature: '2/4', key: null, capo: null, tuning: null, warnings: [],
    columns: xs.map((_, i) => ({ id: i + 1, notes: [{ string: 1, text: '5', technique: 'none' as const }] })),
    measures: [{ measure: 1, timeSignature: null, events: xs.map((_, i) => ({ type: 'column' as const, column: i + 1, duration: i < 6 ? ('16' as const) : ('4' as const), dotted: false, tuplet: i < 6 ? tuplet : 0 })) }],
  })

  it('guesses 6 from six columns under a measured bracket, and takes the number the AI read', () => {
    const layout = layoutFromDetection(d)!
    expect(layout.columns.map((c) => c.tuplet)).toEqual([6, 6, 6, 6, 6, 6, 0])
    const r = markedToRecognition(answerWith(0), layout)
    expect(r.measures[0].beats.map((b) => tupletOf(b))).toEqual([6, 6, 6, 6, 6, 6, 0])
    expect(r.warnings).toEqual([])
    expect(markedToRecognition(answerWith(3), layout).measures[0].beats.map((b) => tupletOf(b))).toEqual([3, 3, 3, 3, 3, 3, 0])
    const s = toImportedSheet(r, 'x')
    expect((s.content as { measures: { beats: { tuplet?: number }[] }[] }).measures[0].beats.map((b) => b.tuplet ?? 0)).toEqual([6, 6, 6, 6, 6, 6, 0])
  })

  it('reads a sextuplet measured under the TAB', () => {
    const six: ColumnRhythm = { duration: 16, dotted: false, triplet: true, tuplet: 6 }
    const layout = { strings: 6, measures: [{ no: 1, columns: [1, 2, 3, 4, 5, 6, 7], x0: 0, x1: 200 }], columns: xs.map((x, i) => ({ id: i + 1, staff: 0, x, rhythm: i < 6 ? six : { duration: 4 as const, dotted: false, triplet: false }, boxes: [{ string: 1, box: { x0: x - 2, y0: 0, x1: x + 2, y1: 4 } }] })) }
    const r = markedToRecognition(answerWith(0), layout)
    expect(r.measures[0].beats.map((b) => [b.duration, tupletOf(b)])).toEqual([...Array(6).fill(['16', 6]), ['4', 0]])
    expect(r.warnings).toEqual([])
  })
})
