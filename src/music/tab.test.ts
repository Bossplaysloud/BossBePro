import { describe, expect, it } from 'vitest'
import * as at from '@coderline/alphatab'
import { tabToAlphaTex } from './alphatex'
import { applyShape, chordAt, insertMeasureAfter, setChord, setMeasureTs, tsAt, beatTicks, cycleBend, cycleSlide, cycleTuplet, deleteBeat, emptyTab, fretsUsed, insertBeatAfter, measureFill, rangeFor, setDuration, setNote, stepBeat, toggleDot, toggleFlag, toggleHarmonic, toggleLegato, toggleTie } from './tab'

const ts: [number, number] = [4, 4]

describe('tab model', () => {
  it('starts with measures exactly filled', () => {
    const c = emptyTab(ts)
    expect(c.measures).toHaveLength(2)
    expect(measureFill(c.measures[0], ts)).toBe(0)
    expect(measureFill(emptyTab([6, 8]).measures[0], [6, 8])).toBe(0)
  })

  it('keeps one note per string per beat', () => {
    let c = emptyTab(ts)
    c = setNote(c, { m: 0, b: 0, s: 6 }, 3)
    c = setNote(c, { m: 0, b: 0, s: 6 }, 5)
    c = setNote(c, { m: 0, b: 0, s: 1 }, 0)
    expect(c.measures[0].beats[0].notes).toEqual([{ string: 1, fret: 0 }, { string: 6, fret: 5 }])
    c = setNote(c, { m: 0, b: 0, s: 6 }, null)
    expect(c.measures[0].beats[0].notes).toHaveLength(1)
    expect(setNote(c, { m: 0, b: 1, s: 2 }, 99, 24).measures[0].beats[1].notes[0].fret).toBe(24)
  })

  it('reports over/under-filled measures', () => {
    let c = emptyTab(ts)
    c = insertBeatAfter(c, 0, 0)
    expect(measureFill(c.measures[0], ts)).toBeGreaterThan(0)
    c = deleteBeat(deleteBeat(c, 0, 0), 0, 0)
    expect(measureFill(c.measures[0], ts)).toBeLessThan(0)
    c = setDuration(c, 0, 0, 2)
    c = toggleDot(c, 0, 0) // dotted half (3/4) + two quarters = 5/4: one quarter over
    expect(measureFill(c.measures[0], ts)).toBe(3840 / 4)
  })

  it('steps across measure boundaries', () => {
    const c = emptyTab(ts)
    expect(stepBeat(c, { m: 0, b: 3, s: 1 }, 1)).toEqual({ m: 1, b: 0, s: 1 })
    expect(stepBeat(c, { m: 1, b: 0, s: 1 }, -1)).toEqual({ m: 0, b: 3, s: 1 })
    expect(stepBeat(c, { m: 1, b: 3, s: 1 }, 1)).toBeNull()
  })

  it('aggregates frets in a range', () => {
    let c = emptyTab(ts)
    c = setNote(c, { m: 0, b: 0, s: 6 }, 3)
    c = setNote(c, { m: 0, b: 1, s: 6 }, 3)
    c = setNote(c, { m: 1, b: 0, s: 5 }, 2)
    c = setNote(c, { m: 1, b: 1, s: 4 }, 'x')
    expect(fretsUsed(c, 0, 1, 6)).toEqual([{ string: 6, fret: 3, count: 2 }])
    expect(fretsUsed(c, 0, 2, 6)).toHaveLength(2)
    expect(fretsUsed(c, 0, 2, 5)).toHaveLength(1) // string 6 beyond a 5-string tuning
    expect(rangeFor(5, 4, 10)).toEqual([4, 8])
    expect(rangeFor(9, 4, 10)).toEqual([8, 10])
    expect(rangeFor(3, 0, 10)).toEqual([0, 10])
  })
})

describe('alphaTex', () => {
  it('produces a score alphaTab can read with matching notes', () => {
    let c = emptyTab([3, 4])
    c = setNote(c, { m: 0, b: 0, s: 6 }, 3)
    c = setNote(c, { m: 0, b: 1, s: 1 }, 0)
    c = setNote(c, { m: 0, b: 1, s: 2 }, 1)
    c = setNote(c, { m: 1, b: 0, s: 5 }, 'x')
    c = toggleDot(setDuration(c, 1, 1, 4), 1, 1)
    const tex = tabToAlphaTex(c, { title: 'He said "hi"', tempo: 90, tuning: [64, 59, 55, 50, 45, 37], timeSignature: [3, 4] })
    const score = at.importer.ScoreLoader.loadAlphaTex(tex)
    expect(score.title).toBe('He said "hi"')
    const staff = score.tracks[0].staves[0]
    expect(staff.stringTuning.tunings).toEqual([64, 59, 55, 50, 45, 37])
    const beats = staff.bars[0].voices[0].beats
    // alphaTab model numbers strings from the lowest (1) upward.
    expect(beats[0].notes.map((n) => [n.fret, n.string])).toEqual([[3, 1]])
    expect(beats[1].notes.map((n) => n.fret).sort()).toEqual([0, 1])
    expect(beats[2].isRest).toBe(true)
    expect(staff.bars[1].voices[0].beats[0].notes[0].isDead).toBe(true)
    expect(staff.bars[1].voices[0].beats[1].dots).toBe(1)
  })
})

describe('techniques', () => {
  const cur = { m: 0, b: 0, s: 3 }
  it('keeps techniques when the fret changes and clears them for dead notes', () => {
    let c = setNote(emptyTab(ts), cur, 5)
    c = toggleLegato(c, cur, 'h')
    c = cycleBend(c, cur)
    c = setNote(c, cur, 7)
    expect(c.measures[0].beats[0].notes[0]).toEqual({ string: 3, fret: 7, legato: 'h', bend: 0.5 })
    c = setNote(c, cur, 'x')
    expect(c.measures[0].beats[0].notes[0]).toEqual({ string: 3, fret: 0, dead: true })
    expect(toggleFlag(c, cur, 'vibrato')).toBe(c) // no techniques on dead notes
  })

  it('cycles bend, slide and tuplet values', () => {
    let c = setNote(emptyTab(ts), cur, 5)
    const bends = []
    for (let i = 0; i < 5; i++) {
      c = cycleBend(c, cur)
      bends.push(c.measures[0].beats[0].notes[0].bend)
    }
    expect(bends).toEqual([0.5, 1, 1.5, 2, undefined])
    c = cycleSlide(c, cur, 'in')
    expect(c.measures[0].beats[0].notes[0].slide).toBe('inBelow')
    c = cycleSlide(c, cur, 'in')
    expect(c.measures[0].beats[0].notes[0].slide).toBe('inAbove')
    c = cycleSlide(c, cur, 'out')
    expect(c.measures[0].beats[0].notes[0].slide).toBe('outDown')
    c = cycleTuplet(cycleTuplet(c, 0, 0), 0, 0)
    expect(c.measures[0].beats[0].tuplet).toBe(5)
    expect(beatTicks({ duration: 8, tuplet: 3 }) * 3).toBe(beatTicks({ duration: 4 }))
  })

  it('ties to the previous note across a bar line', () => {
    let c = setNote(emptyTab(ts), { m: 0, b: 3, s: 2 }, 9)
    c = toggleTie(c, { m: 1, b: 0, s: 2 })
    expect(c.measures[1].beats[0].notes[0]).toEqual({ string: 2, fret: 9, tie: true })
    expect(toggleTie(c, { m: 1, b: 1, s: 4 })).toBe(c) // nothing to tie to
    c = toggleTie(c, { m: 1, b: 0, s: 2 })
    expect(c.measures[1].beats[0].notes).toHaveLength(0)
  })

  it('renders every technique through alphaTab', () => {
    let c = emptyTab(ts)
    const at0 = (b: number, s = 3) => ({ m: 0, b, s })
    c = toggleLegato(setNote(c, at0(0), 5), at0(0), 'h')
    c = setNote(c, at0(1), 7)
    c = cycleSlide(setNote(c, at0(2), 5), at0(2), 'to')
    c = toggleFlag(cycleBend(cycleBend(setNote(c, at0(3), 7), at0(3)), at0(3)), at0(3), 'release')
    c = toggleHarmonic(setNote(c, { m: 1, b: 0, s: 1 }, 12), { m: 1, b: 0, s: 1 }, 'natural')
    c = toggleFlag(setNote(c, { m: 1, b: 1, s: 6 }, 3), { m: 1, b: 1, s: 6 }, 'palmMute')
    c = toggleFlag(c, { m: 1, b: 1, s: 6 }, 'vibrato')
    c = toggleTie(c, { m: 1, b: 2, s: 6 })
    c = cycleTuplet(setDuration(c, 1, 3, 8), 1, 3)
    const tex = tabToAlphaTex(c, { title: 't', tempo: 100, tuning: [64, 59, 55, 50, 45, 40], timeSignature: ts })
    const staff = at.importer.ScoreLoader.loadAlphaTex(tex).tracks[0].staves[0]
    const n = (bar: number, beat: number) => staff.bars[bar].voices[0].beats[beat].notes[0]
    expect(n(0, 0).isHammerPullOrigin).toBe(true)
    expect(n(0, 2).slideOutType).toBe(at.model.SlideOutType.Legato)
    expect(n(0, 3).bendPoints!.map((p) => p.value)).toEqual([0, 4, 4, 0])
    expect(n(1, 0).harmonicType).toBe(at.model.HarmonicType.Natural)
    expect(n(1, 1).isPalmMute).toBe(true)
    expect(n(1, 1).vibrato).toBe(at.model.VibratoType.Slight)
    expect(n(1, 2).isTieDestination).toBe(true)
    expect(staff.bars[1].voices[0].beats[3].tupletNumerator).toBe(3)
  })

  it('toggles tapping and renders it with bends, vibrato and harmonics', () => {
    let c = emptyTab(ts)
    const cur = { m: 0, b: 0, s: 2 }
    c = toggleFlag(setNote(c, cur, 12), cur, 'tap')
    expect(c.measures[0].beats[0].notes[0]).toEqual({ string: 2, fret: 12, tap: true })
    c = toggleTie(setNote(c, { m: 0, b: 1, s: 1 }, 7), { m: 0, b: 2, s: 1 })
    c = toggleFlag(c, { m: 0, b: 1, s: 1 }, 'tap')
    c = toggleFlag(cycleBend(cycleBend(setNote(c, { m: 1, b: 0, s: 3 }, 9), { m: 1, b: 0, s: 3 }), { m: 1, b: 0, s: 3 }), { m: 1, b: 0, s: 3 }, 'vibrato')
    c = toggleHarmonic(setNote(c, { m: 1, b: 1, s: 1 }, 7), { m: 1, b: 1, s: 1 }, 'artificial')
    const tex = tabToAlphaTex(c, { title: 't', tempo: 100, tuning: [64, 59, 55, 50, 45, 40], timeSignature: ts })
    const staff = at.importer.ScoreLoader.loadAlphaTex(tex).tracks[0].staves[0]
    const beat = (bar: number, b: number) => staff.bars[bar].voices[0].beats[b]
    expect([0, 1, 2, 3].map((b) => beat(0, b).tap)).toEqual([true, true, false, false]) // the tied continuation is not tapped
    expect(beat(1, 0).notes[0].bendPoints!.map((p) => p.value)).toEqual([0, 4])
    expect(beat(1, 0).notes[0].vibrato).toBe(at.model.VibratoType.Slight)
    expect(beat(1, 1).notes[0].harmonicType).toBe(at.model.HarmonicType.Artificial)
    expect(toggleFlag(c, cur, 'tap').measures[0].beats[0].notes[0]).toEqual({ string: 2, fret: 12 })
  })
})

describe('time signature changes and chords', () => {
  it('tracks the signature in effect and refills empty measures', () => {
    let c = emptyTab(ts)
    c = insertMeasureAfter(c, 1, ts)
    c = setMeasureTs(c, 1, [3, 4], ts)
    expect(c.measures[1].beats).toHaveLength(3)
    expect(tsAt(c, 0, ts)).toEqual([4, 4])
    expect(tsAt(c, 2, ts)).toEqual([3, 4])
    expect(measureFill(c.measures[1], tsAt(c, 1, ts))).toBe(0)
    c = setMeasureTs(c, 1, null, ts)
    expect(c.measures[1].beats).toHaveLength(4)
    expect(c.measures[1].timeSignature).toBeUndefined()
  })

  it('keeps chord context and renders both in alphaTab', () => {
    let c = emptyTab(ts)
    c = setChord(c, 0, 1, 'Am7')
    c = applyShape(c, 0, 1, [0, 1, 0, 2, 0, null])
    c = setMeasureTs(c, 1, [6, 8], ts)
    expect(chordAt(c, 0, 0)).toBeUndefined()
    expect(chordAt(c, 1, 2)).toBe('Am7')
    expect(fretsUsed(c, 1, 2, 6)).toEqual([])
    expect(fretsUsed(c, 0, 1, 6).every((u) => u.chord === 'Am7')).toBe(true)
    const tex = tabToAlphaTex(c, { title: 't', tempo: 100, tuning: [64, 59, 55, 50, 45, 40], timeSignature: ts })
    const score = at.importer.ScoreLoader.loadAlphaTex(tex)
    expect(score.masterBars.map((b) => `${b.timeSignatureNumerator}/${b.timeSignatureDenominator}`)).toEqual(['4/4', '6/8'])
    expect(score.tracks[0].staves[0].bars[0].voices[0].beats[1].chord?.name).toBe('Am7')
  })
})

describe('custom fretboard range', () => {
  it('counts only the notes between the chosen ends', async () => {
    const { customSpan } = await import('./rhythm')
    let c = emptyTab([4, 4])
    c = setNote(c, { m: 0, b: 0, s: 6 }, 3)
    c = setNote(c, { m: 0, b: 1, s: 5 }, 2)
    c = setNote(c, { m: 1, b: 0, s: 4 }, 5)
    c = setNote(c, { m: 1, b: 1, s: 3 }, 7)
    // from bar 1 note 2 to bar 2 note 1
    const span = customSpan({ from: { m: 0, b: 1 }, to: { m: 1, b: 0 } }, c.measures.length)
    expect(fretsUsed(c, 0, 2, 6, span).map((u) => `${u.string}:${u.fret}`)).toEqual(['5:2', '4:5'])
    // a missing note means the whole bar; ends given backwards are put in order
    const whole = customSpan({ from: { m: 1, b: null }, to: { m: 0, b: null } }, c.measures.length)
    expect(whole).toEqual({ from: { m: 0, b: 0 }, to: { m: 1, b: Infinity } })
    expect(fretsUsed(c, 0, 2, 6, whole)).toHaveLength(4)
  })
})
