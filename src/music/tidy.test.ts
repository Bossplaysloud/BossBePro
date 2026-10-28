import { describe, expect, it } from 'vitest'
import { emptyChordChart } from './chordChart'
import { emptyMelody, setPitch, toggleMelodyTie } from './melody'
import { measureFill, setChord, setDuration, tsAt } from './rhythm'
import { emptyTab, setNote, toggleLegato, type TabContent } from './tab'
import { normalizeChordName, tidyChart, tidyContent } from './tidy'

const ts: [number, number] = [4, 4]
const all = { length: 'smart' as const, chords: true, techniques: true, emptyEdges: true }
const frets = (c: TabContent) => c.measures.map((m) => m.beats.map((b) => b.notes[0]?.fret ?? '-').join(''))

/** A bar of quarter notes on string 1 with the given frets ('-' = rest). */
function bar(c: TabContent, m: number, pattern: string) {
  ;[...pattern].forEach((ch, b) => {
    if (ch !== '-') c = setNote(c, { m, b, s: 1 }, Number(ch))
  })
  return c
}

describe('normalizeChordName', () => {
  it('fixes common variants', () => {
    expect(normalizeChordName('Ａｍ')).toBe('Am')
    expect(normalizeChordName('C♯m7')).toBe('C#m7')
    expect(normalizeChordName('am')).toBe('Am')
    expect(normalizeChordName('Gmin7')).toBe('Gm7')
    expect(normalizeChordName('C/g')).toBe('C/G')
    expect(normalizeChordName('???')).toBeNull()
  })
})

describe('tidyContent', () => {
  it('removes bars repeated across an image boundary', () => {
    let c: TabContent = { ...emptyTab(ts), measures: [...emptyTab(ts).measures, ...emptyTab(ts).measures] }
    c = bar(bar(bar(bar(c, 0, '1234'), 1, '5678'), 2, '5678'), 3, '9999')
    // Image 2 starts at bar 2 and repeats bar 1.
    const { content, report } = tidyContent(c, ts, { ...all, overlaps: [2] })
    expect(frets(content)).toEqual(['1234', '5678', '9999'])
    expect(report.overlaps).toBe(1)
  })

  it('fixes bar lengths: scales doubled durations, pads, moves overflow', () => {
    let c = bar(emptyTab(ts), 0, '12')
    // bar 1: 8 quarters (AI read eighths as quarters)
    c = { ...c, measures: [{ ...c.measures[0], beats: Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, duration: 4 as const, notes: [{ string: 1, fret: i }] })) }, c.measures[1]] }
    // bar 2: only two quarters
    c = bar(c, 1, '33')
    c = { ...c, measures: [c.measures[0], { ...c.measures[1], beats: c.measures[1].beats.slice(0, 2) }] }
    const { content, report } = tidyContent(c, ts, all)
    expect(content.measures[0].beats.every((b) => b.duration === 8)).toBe(true)
    content.measures.forEach((m, i) => expect(measureFill(m, tsAt(content, i, ts))).toBe(0))
    expect(report.lengths).toBe(2)
    // an odd overflow (5 quarters) moves the extra beat to a new bar instead of scaling
    const odd = setDuration(bar(emptyTab(ts), 0, '1234'), 0, 3, 2)
    const fixed = tidyContent(odd, ts, { ...all, emptyEdges: false }).content
    expect(fixed.measures.length).toBe(3)
  })

  it('fixes chords, dangling techniques and ties, and trims empty edge bars', () => {
    let c: TabContent = { ...emptyTab(ts), measures: [emptyTab(ts).measures[0], ...emptyTab(ts).measures, emptyTab(ts).measures[0]] }
    c = bar(c, 1, '57')
    c = setChord(c, 1, 0, 'ａｍ')
    c = setChord(c, 1, 1, 'xyz')
    c = toggleLegato(c, { m: 1, b: 1, s: 1 }, 'h') // nothing follows on string 1 → removed
    c = { ...c, measures: c.measures.map((m, i) => (i !== 2 ? m : { ...m, beats: m.beats.map((b, j) => (j === 0 ? { ...b, notes: [{ string: 1, fret: 9, tie: true }] } : b)) })) } // tie from a 7 → untied
    const { content, report } = tidyContent(c, ts, all)
    expect(report).toMatchObject({ chordsFixed: 1, chordsRemoved: 1, techniques: 2, empty: 2 })
    expect(content.measures.length).toBe(2)
    expect(content.measures[0].beats[0].chord).toBe('Am')
    expect(content.measures[0].beats[1].notes[0]).toEqual({ string: 1, fret: 7 })
    expect(content.measures[1].beats[0].notes[0]).toEqual({ string: 1, fret: 9 })
  })

  it('unties melody notes whose pitch changed', () => {
    let c = setPitch(setPitch(emptyMelody(ts), 0, 0, 60), 0, 1, 60)
    c = toggleMelodyTie(c, { m: 0, b: 1, s: 1 })
    c = setPitch(c, 0, 0, 62) // previous note changed after the tie was made
    const { content, report } = tidyContent(c, ts, { ...all, length: 'none' })
    expect(content.measures[0].beats[1].notes[0].tie).toBeUndefined()
    expect(report.techniques).toBe(1)
  })
})

describe('tidyChart', () => {
  it('converts, normalizes chords, squeezes blank lines and finds the capo', () => {
    const { content, report } = tidyChart({ ...emptyChordChart(), text: 'Capo 2\nam      F\n我們的故事\n\n\n\n[ｇ]走  \n\n' })
    expect(content.text).toBe('Capo 2\n[Am]我們的故[F]事\n\n[G]走')
    expect(content.capo).toBe(2)
    expect(report).toMatchObject({ converted: true, chordsFixed: 2, capo: 2 })
    expect(report.blankLines).toBeGreaterThan(0)
  })
})
