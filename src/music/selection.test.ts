import { describe, expect, it } from 'vitest'
import { emptyTab, setNote, type TabContent } from './tab'
import { beatsInRange, clearRange, insertBeatsAt, insertMeasuresAt, isWholeMeasures, measuresInRange, orderRange, overwriteAt, removeRange } from './rhythm'

const ts: [number, number] = [4, 4]
// Bar 1 frets 1-4 on string 1, bar 2 frets 5-8.
function sample(): TabContent {
  let c = emptyTab(ts)
  for (let i = 0; i < 8; i++) c = setNote(c, { m: Math.floor(i / 4), b: i % 4, s: 1 }, i + 1)
  return c
}
const frets = (c: TabContent) => c.measures.map((m) => m.beats.map((b) => b.notes[0]?.fret ?? '-').join(''))

describe('selection editing', () => {
  it('orders ranges and detects whole measures', () => {
    const c = sample()
    expect(orderRange({ m: 1, b: 2 }, { m: 0, b: 1 })).toEqual([{ m: 0, b: 1 }, { m: 1, b: 2 }])
    expect(isWholeMeasures(c, [{ m: 0, b: 0 }, { m: 1, b: 3 }])).toBe(true)
    expect(isWholeMeasures(c, [{ m: 0, b: 1 }, { m: 1, b: 3 }])).toBe(false)
  })

  it('copies beats across a bar line with fresh ids', () => {
    const c = sample()
    const beats = beatsInRange(c, [{ m: 0, b: 2 }, { m: 1, b: 1 }])
    expect(beats.map((b) => b.notes[0].fret)).toEqual([3, 4, 5, 6])
    expect(beats[0].id).not.toBe(c.measures[0].beats[2].id)
  })

  it('removes and clears ranges', () => {
    const c = sample()
    expect(frets(removeRange(c, [{ m: 0, b: 2 }, { m: 1, b: 1 }], ts))).toEqual(['12', '78'])
    expect(frets(removeRange(c, [{ m: 0, b: 0 }, { m: 0, b: 3 }], ts))).toEqual(['5678'])
    expect(frets(removeRange(c, [{ m: 0, b: 0 }, { m: 1, b: 3 }], ts))).toEqual(['----'])
    expect(frets(clearRange(c, [{ m: 0, b: 3 }, { m: 1, b: 0 }]))).toEqual(['123-', '-678'])
  })

  it('pastes by inserting beats or measures, or by overwriting', () => {
    const c = sample()
    const clip = beatsInRange(c, [{ m: 1, b: 0 }, { m: 1, b: 1 }]) // 5 6
    expect(frets(insertBeatsAt(c, { m: 0, b: 1 }, clip))).toEqual(['156234', '5678'])
    expect(frets(insertBeatsAt(c, { m: 0, b: 4 }, clip))).toEqual(['123456', '5678'])
    expect(frets(insertMeasuresAt(c, 1, measuresInRange(c, [{ m: 0, b: 0 }, { m: 0, b: 3 }])))).toEqual(['1234', '1234', '5678'])
    const { content, end } = overwriteAt(c, { m: 0, b: 3 }, clip)
    expect(frets(content)).toEqual(['1235', '6678'])
    expect(end).toEqual({ m: 1, b: 0 })
    const past = overwriteAt(c, { m: 1, b: 3 }, beatsInRange(c, [{ m: 0, b: 0 }, { m: 0, b: 2 }]))
    expect(frets(past.content)).toEqual(['1234', '567123'])
  })
})
