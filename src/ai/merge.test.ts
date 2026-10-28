import { describe, expect, it } from 'vitest'
import { continuationHint, mergeRecognitions } from './merge'
import { emptyChart, type Recognition } from './schema'

const r = (over: Partial<Recognition>): Recognition => ({
  notation: 'tab', title: null, strings: null, tuning: null, key: null, timeSignature: null, tempo: null, capo: null,
  measures: [], chart: emptyChart(), chordChart: null, warnings: [], ...over,
})
const bar = (n: number) => ({ timeSignature: null, beats: [{ duration: '4' as const, dotted: false, triplet: false, chord: `C${n}`, lyric: null, tab: [], pitch: null, degree: null, tie: false }] })

describe('mergeRecognitions', () => {
  it('appends bars in image order and keeps the first stated settings', () => {
    const merged = mergeRecognitions(
      [
        r({ title: 'Song', strings: 6, key: 'G', measures: [bar(1), bar(2)], warnings: ['a'] }),
        r({ title: null, key: 'D', tempo: 120, measures: [bar(3)], warnings: ['b'] }),
        r({ notation: 'unknown' }),
      ],
      (i, w) => `#${i}:${w}`,
    )
    expect(merged.measures.map((m) => m.beats[0].chord)).toEqual(['C1', 'C2', 'C3'])
    expect(merged).toMatchObject({ notation: 'tab', title: 'Song', strings: 6, key: 'G', tempo: 120 })
    expect(merged.warnings).toEqual(['#1:a', '#2:b', '#3:—'])
  })

  it('joins chord chart text', () => {
    const merged = mergeRecognitions([r({ notation: 'chord', chordChart: '[C]a' }), r({ notation: 'chord', chordChart: '[G]b' })], (_, w) => w)
    expect(merged.chordChart).toBe('[C]a\n\n[G]b')
  })

  it('tells the AI what earlier images were read as', () => {
    const hint = continuationHint([r({ strings: 7, key: 'Em', tuning: ['B1', 'E2'] })], 1, 3)
    expect(hint).toContain('image 2 of 3')
    expect(hint).toContain('7 strings')
    expect(hint).toContain('key Em')
  })
})
