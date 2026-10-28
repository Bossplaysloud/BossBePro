import { describe, expect, it } from 'vitest'
import {
  emptyTab, fillWithRests, fitTimeSignature, fittingTimeSignature, insertBeatAfter, measureFill, measureTicks,
  overflowToNewMeasure, reflowFrom, scaleMeasure, setDuration, setNote, toggleFree, trimToFit, tsAt, type TabContent,
} from './tab'

const ts: [number, number] = [4, 4]
const Q = 960

/** One measure with five quarter notes on string 1: frets 1..5. */
function fiveQuarters(): TabContent {
  let c = insertBeatAfter(emptyTab(ts), 0, 3)
  for (let b = 0; b < 5; b++) c = setNote(c, { m: 0, b, s: 1 }, b + 1)
  return c
}
const frets = (c: TabContent, m: number) => c.measures[m].beats.map((b) => b.notes.map((n) => (n.tie ? `~${n.fret}` : n.fret)).join('') || '-')

describe('fixing measure length', () => {
  it('moves the overflow into a new measure', () => {
    const c = overflowToNewMeasure(fiveQuarters(), 0, ts)
    expect(c.measures).toHaveLength(3)
    expect(frets(c, 0)).toEqual(['1', '2', '3', '4'])
    expect(frets(c, 1)).toEqual(['5', '-', '-', '-'])
    expect(measureFill(c.measures[1], ts)).toBe(0)
  })

  it('splits a note crossing the bar line into a tie', () => {
    let c = setDuration(fiveQuarters(), 0, 3, 2) // 1/4 ×3 + 1/2 + 1/4 = 6 quarters
    c = overflowToNewMeasure(c, 0, ts)
    expect(frets(c, 0)).toEqual(['1', '2', '3', '4'])
    expect(frets(c, 1).slice(0, 2)).toEqual(['~4', '5'])
    expect(measureTicks(c.measures[0])).toBe(4 * Q)
  })

  it('reflows the rest of the song', () => {
    const c = reflowFrom(fiveQuarters(), 0, ts) // measure 2 was empty: its rests are dropped
    expect(c.measures).toHaveLength(2)
    expect(frets(c, 0)).toEqual(['1', '2', '3', '4'])
    expect(frets(c, 1)).toEqual(['5', '-', '-', '-'])
    // pulling back an underfilled measure
    let d = setNote(emptyTab(ts), { m: 1, b: 0, s: 2 }, 7)
    d = { ...d, measures: [{ ...d.measures[0], beats: d.measures[0].beats.slice(0, 2) }, d.measures[1]] }
    d = reflowFrom(d, 0, ts)
    expect(frets(d, 0)).toEqual(['-', '-', '7', '-'])
    expect(d.measures).toHaveLength(1)
  })

  it('keeps later time signature changes when reflowing', () => {
    let c = fiveQuarters()
    c = { ...c, measures: [...c.measures, { id: 'x', timeSignature: [3, 4], beats: [] }] }
    c = reflowFrom(c, 0, ts)
    expect(c.measures.map((m) => m.timeSignature?.join('/') ?? '')).toEqual(['', '', '3/4'])
    expect(tsAt(c, 2, ts)).toEqual([3, 4])
  })

  it('fits the time signature and restores the meter afterwards', () => {
    const c = fitTimeSignature(fiveQuarters(), 0, ts)
    expect(c.measures[0].timeSignature).toEqual([5, 4])
    expect(c.measures[1].timeSignature).toEqual([4, 4])
    const eighth = setDuration(fiveQuarters(), 0, 4, 8)
    expect(fittingTimeSignature(eighth.measures[0])).toEqual([9, 8])
  })

  it('trims, fills, scales and marks free', () => {
    expect(frets(trimToFit(fiveQuarters(), 0, ts), 0)).toEqual(['1', '2', '3', '4'])
    const short = { ...emptyTab(ts), measures: [{ id: 'a', beats: emptyTab(ts).measures[0].beats.slice(0, 1) }] }
    expect(measureFill(fillWithRests(short, 0, ts).measures[0], ts)).toBe(0)
    const halved = scaleMeasure(fiveQuarters(), 0, 2)!
    expect(halved.measures[0].beats.every((b) => b.duration === 8)).toBe(true)
    expect(scaleMeasure(setDuration(fiveQuarters(), 0, 0, 32), 0, 2)).toBeNull()
    expect(toggleFree(fiveQuarters(), 0).measures[0].free).toBe(true)
  })
})

describe('tuplets', () => {
  it('moves a tuplet beat whole instead of splitting it', async () => {
    const { cycleTuplet } = await import('./tab')
    let c = fiveQuarters()
    c = cycleTuplet(setDuration(c, 0, 4, 8), 0, 4) // four quarters + an eighth triplet
    c = overflowToNewMeasure(c, 0, ts)
    expect(c.measures[0].beats.at(-1)!.tuplet).toBeUndefined()
    expect(c.measures[1].beats.some((b) => b.tuplet)).toBe(true)
    expect(c.measures[1].beats.every((b) => b.notes.every((n) => !n.tie))).toBe(true)
  })
})
