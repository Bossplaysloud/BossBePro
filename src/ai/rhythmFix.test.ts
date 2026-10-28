import { describe, expect, it } from 'vitest'
import { checkMeasures, fixTuplets, mergeColumns, reflowBySpacing } from './rhythmFix'
import type { RecognizedBeat } from './schema'

const b = (duration: RecognizedBeat['duration'], x: number | null, tab: [number, number][] = [[6, 3]], extra: Partial<RecognizedBeat> = {}): RecognizedBeat => ({
  duration, dotted: false, triplet: false, chord: null, lyric: null, pitch: null, degree: null, tie: false, x,
  tab: tab.map(([string, fret]) => ({ string, fret, dead: false, tie: false, techniques: [] })), ...extra,
})

describe('TAB measure checks', () => {
  it('joins a column read as two beats', () => {
    const { beats, merged } = mergeColumns([b('4', 100, [[1, 3], [2, 3]]), b('4', 103, [[6, 3]]), b('8', 200, [[3, 2]])])
    expect(merged).toBe(1)
    expect(beats).toHaveLength(2)
    expect(beats[0].tab.map((n) => n.string)).toEqual([1, 2, 6])
  })

  it('drops triplet marks that do not make whole groups', () => {
    const t = (d: RecognizedBeat['duration']) => b(d, null, [[6, 3]], { triplet: true })
    expect(fixTuplets([t('8'), t('8'), t('8')]).fixed).toBe(0)
    const { beats, fixed } = fixTuplets([b('4', null), t('8'), b('8', null), t('8'), t('8')])
    expect(fixed).toBe(2) // a lone triplet eighth, then a pair
    expect(beats.every((x) => !x.triplet)).toBe(true)
  })

  it('rebuilds a 6/8 bar from the spacing when it does not add up', () => {
    // dotted quarter chord, then three eighths; the AI gave quarters
    const beats = [b('4', 100), b('4', 250), b('4', 300), b('4', 350)]
    const out = reflowBySpacing({ timeSignature: null, beats, start: 80, end: 400 }, 24)!
    expect(out.map((x) => [x.duration, x.dotted])).toEqual([['4', true], ['8', false], ['8', false], ['8', false]])
  })

  it('leaves correct bars and a short pickup alone, and reports the rest', () => {
    const ts: [number, number] = [6, 8]
    const ok = { timeSignature: null, beats: [b('4', 0, [[6, 3]], { dotted: true }), b('4', 50, [[6, 3]], { dotted: true })], start: null, end: null }
    const pickup = { timeSignature: null, beats: [b('8', 10)], start: null, end: null }
    const long = { timeSignature: null, beats: [b('2', null), b('2', null)], start: null, end: null }
    const r = checkMeasures([pickup, ok, long, ok], () => ts, true)
    expect(r.reflowed).toEqual([])
    expect(r.wrong).toEqual([3])
  })
})

describe('pickup measures', () => {
  const q = (n: number) => Array.from({ length: n }, () => b('4', null))
  const m = (beats: RecognizedBeat[]) => ({ timeSignature: null, beats, start: null, end: null })
  const ts = (): [number, number] => [4, 4]

  it('keeps a pickup whose last measure makes up the rest', () => {
    expect(checkMeasures([m(q(1)), m(q(4)), m(q(3))], ts, false).wrong).toEqual([])
  })

  it('reports short first and last measures that are not a pickup (3 + 3 beats in 4/4)', () => {
    expect(checkMeasures([m(q(3)), m(q(4)), m(q(3))], ts, false).wrong).toEqual([1, 3])
  })
})

describe('sextuplets', () => {
  const s = (d: RecognizedBeat['duration']) => b(d, null, [[1, 5]], { tuplet: 6 })

  it('keeps whole sextuplet groups (6 in the time of 4) and drops broken ones', () => {
    expect(fixTuplets(Array.from({ length: 6 }, () => s('16'))).fixed).toBe(0)
    const { beats, fixed } = fixTuplets([b('4', null), s('16')])
    expect(fixed).toBe(1) // a lone sextuplet sixteenth
    expect(beats.map((x) => x.tuplet)).toEqual([0, 0])
    expect(fixTuplets([b('8', null, [[1, 5]], { tuplet: 4 })]).fixed).toBe(1) // no such tuplet in the editor
  })

  it('counts six sextuplet sixteenths as one quarter', () => {
    const r = checkMeasures([{ timeSignature: null, beats: [b('4', null), b('4', null), b('4', null), ...Array.from({ length: 6 }, () => s('16'))] }], () => [4, 4], false)
    expect([r.wrong, r.reflowed, r.tuplets]).toEqual([[], [], 0])
    expect(r.measures[0].beats.map((x) => x.tuplet)).toEqual([0, 0, 0, 6, 6, 6, 6, 6, 6])
  })

  it('still reads the older triplet flag', () => {
    const out = fixTuplets([1, 2, 3].map(() => b('8', null, [[1, 5]], { triplet: true }))).beats
    expect(out.map((x) => [x.tuplet, x.triplet])).toEqual([[3, undefined], [3, undefined], [3, undefined]])
  })
})
