import { describe, expect, it } from 'vitest'
import { fuseMeasured, measuredMeasures } from './measuredStaff'
import type { StaffAnswer, StaffLayout } from './markedStaff'
import type { NoteHead } from '../lib/noteHeads'
import type { Detection } from '../lib/tabDetect'

const SP = 10
const head = (x: number, step: number, more: Partial<NoteHead> = {}): NoteHead => ({
  x,
  y: 100 + step * 5,
  step,
  filled: true,
  box: { x0: x - 6, y0: 95 + step * 5, x1: x + 6, y1: 105 + step * 5 },
  stem: { dir: 'up', x: x + 6, end: 70 + step * 5 },
  beams: 0,
  dots: 0,
  ...more,
})

function detection(): Detection {
  return {
    width: 400,
    height: 200,
    staves: [
      {
        kind: 'staff',
        lines: [100, 110, 120, 130, 140],
        spacing: SP,
        x0: 0,
        x1: 400,
        barLines: [0, 200, 400],
        numbers: [],
        columns: [],
        tuplets: [[20, 60]], // a "bracket" that is really a chord symbol's underline
        // M1: rest, G4, A4, Bb4 (quarters). M2: whole note E5 (no stem) — then a measure that does not add up.
        heads: [head(70, 6), head(110, 5), head(150, 4, { accidental: 'flat' }), head(250, 1, { filled: false, stem: undefined }), head(300, 6)],
        rests: [{ x: 30, y: 120, value: 4, box: { x0: 26, y0: 105, x1: 34, y1: 135 } }],
      },
    ],
  }
}

const layout: StaffLayout = { measures: [{ no: 1, staff: 0, x0: 0, x1: 200 }, { no: 2, staff: 0, x0: 200, x1: 400 }] }

const ai: StaffAnswer = {
  title: null,
  tempo: 120,
  timeSignature: '4/4',
  keySignature: 0,
  key: null,
  warnings: [],
  measures: [
    {
      measure: 1,
      keySignature: null,
      timeSignature: null,
      voices: [
        {
          voice: 1,
          events: [
            { rest: true, chord: null, notes: [], value: '4', dots: 0, tuplet: 0, grace: false },
            { rest: false, chord: 'Cm7', notes: [{ position: 'A4', accidental: 'none', tie: false, string: null, finger: null }], value: '4', dots: 0, tuplet: 0, grace: false },
            { rest: false, chord: null, notes: [{ position: 'B4', accidental: 'none', tie: true, string: null, finger: null }], value: '2', dots: 0, tuplet: 0, grace: false },
          ],
        },
      ],
    },
    { measure: 2, keySignature: null, timeSignature: null, voices: [{ voice: 1, events: [{ rest: false, chord: 'F7', notes: [{ position: 'C5', accidental: 'none', tie: false, string: null, finger: null }], value: '1', dots: 0, tuplet: 0, grace: false }] }] },
  ],
}

describe('measured staff', () => {
  it('lays out measured heads and rests as events', () => {
    const m = measuredMeasures(detection(), layout)
    expect(m.get(1)!.map((e) => (e.rest ? `R${e.value}` : `${e.notes[0].position}/${e.value}`))).toEqual(['R4', 'G4/4', 'A4/4', 'B4/4'])
    expect(m.get(1)![3].notes[0].accidental).toBe('flat')
    expect(m.get(2)!.map((e) => e.value)).toEqual(['1', '4'])
  })

  it('uses the measured measure when it adds up, keeping the AI chord symbols and ties; falls back otherwise', () => {
    const { answer, measured, fallback } = fuseMeasured(ai, measuredMeasures(detection(), layout), layout, -2)
    expect(measured).toEqual([1])
    expect(fallback).toEqual([2])
    expect(answer.keySignature).toBe(-2)
    const evs = answer.measures[0].voices[0].events
    // The bogus bracket over the rest is dropped: the measure adds up without it.
    expect(evs.every((e) => e.tuplet === 0)).toBe(true)
    expect(evs.map((e) => e.chord)).toEqual([null, 'Cm7', null, null])
    expect(evs[3].notes[0].tie).toBe(true)
    // Measure 2 stays as the AI read it.
    expect(answer.measures[1].voices[0].events[0].chord).toBe('F7')
  })
})

describe('measured tuplet brackets', () => {
  // 4/4: a bracket over `n` sixteenths, then three quarters.
  const bracketed = (n: number): Detection => ({
    width: 400,
    height: 200,
    staves: [{
      kind: 'staff', lines: [100, 110, 120, 130, 140], spacing: SP, x0: 0, x1: 400, barLines: [0, 400], numbers: [], columns: [],
      tuplets: [[15, 25 + (n - 1) * 20]],
      heads: [...Array.from({ length: n }, (_, i) => head(20 + i * 20, 4, { beams: 2 })), head(250, 4), head(300, 4), head(350, 4)],
      rests: [],
    }],
  })
  const one: StaffLayout = { measures: [{ no: 1, staff: 0, x0: 0, x1: 400 }] }
  const empty: StaffAnswer = { ...ai, measures: [{ measure: 1, keySignature: null, timeSignature: null, voices: [] }] }

  it('takes six notes under a bracket as a sextuplet and five as a quintuplet', () => {
    for (const n of [6, 5]) {
      const { answer, measured } = fuseMeasured(empty, measuredMeasures(bracketed(n), one), one)
      expect(measured).toEqual([1])
      expect(answer.measures[0].voices[0].events.map((e) => e.tuplet)).toEqual([...Array(n).fill(n), 0, 0, 0])
    }
  })
})
