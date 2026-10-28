import { describe, expect, it } from 'vitest'
import { measureCapacity } from './tab'
import { measureTicks, parseTextTab, tabToText } from './textTab'

const ts: [number, number] = [4, 4]
const std = [64, 59, 55, 50, 45, 40]

const notesOf = (r: ReturnType<typeof parseTextTab>) =>
  r.measures.flatMap((m) => m.beats.flatMap((b) => b.notes.filter((n) => !n.tie)))

describe('parseTextTab', () => {
  it('reads evenly spaced notes as an even rhythm', () => {
    const r = parseTextTab('e|-3-5-7-9-|-0---------------|\nB|---------|-----------------|', 2, ts)
    expect(r.measures[0].beats.map((b) => b.duration)).toEqual([4, 4, 4, 4])
    expect(r.measures[1].beats.map((b) => b.duration)).toEqual([1])
    const eighths = parseTextTab('e|-0-0-0-0-0-0-0-0-|', 1, ts)
    expect(eighths.measures[0].beats.map((b) => b.duration)).toEqual([8, 8, 8, 8, 8, 8, 8, 8])
  })

  it('reads a basic block with bars, chords and labels', () => {
    const text = `Intro riff
e|-------0-------|-----------------|
B|-----1---1-----|---3-------------|
G|---0-------0---|---0-------------|
D|-2-------------|---0-------------|
A|---------------|-3---------------|
E|---------------|-----------------|`
    const r = parseTextTab(text, 6, ts)
    expect(r.blockStrings).toEqual([6])
    expect(r.measures).toHaveLength(2)
    r.measures.forEach((m) => expect(measureTicks(m)).toBe(measureCapacity(ts)))
    const firstBeats = r.measures[0].beats.filter((b) => b.notes.some((n) => !n.tie))
    expect(firstBeats.map((b) => b.notes.map((n) => `${n.string}:${n.fret}`).join(' '))).toEqual(['4:2', '3:0', '2:1', '1:0', '2:1', '3:0'])
    const chord = r.measures[1].beats.find((b) => b.notes.length > 1)!
    expect(chord.notes.map((n) => `${n.string}:${n.fret}`)).toEqual(['2:3', '3:0', '4:0'])
  })

  it('reads techniques', () => {
    const text = `   PM------
e|-----------------------------|
B|-3h5-7p5-5/7-7\\5-------------|
G|-7b9-7b9r7-9~-<12>-x-(5)-/7--|
D|-----------------------------|
A|-----------------------------|
E|-0---0-----------------------|`
    const notes = notesOf(parseTextTab(text, 6, ts))
    const on = (s: number, f: number) => notes.filter((n) => n.string === s && n.fret === f)
    expect(on(2, 3)[0].legato).toBe('h')
    expect(on(2, 7)[0].legato).toBe('p')
    expect(on(2, 5).some((n) => n.slide === 'to')).toBe(true)
    expect(on(2, 7).some((n) => n.slide === 'to')).toBe(true)
    expect(on(3, 7).filter((n) => n.bend).map((n) => [n.bend, !!n.release])).toEqual([[1, false], [1, true]])
    expect(on(3, 9)[0].vibrato).toBe(true)
    expect(on(3, 12)[0].harmonic).toBe('natural')
    expect(notes.some((n) => n.string === 3 && n.dead)).toBe(true)
    expect(on(3, 5)[0].ghost).toBe(true)
    expect(notes.find((n) => n.slide === 'inBelow')?.fret).toBe(7)
    expect(on(6, 0).every((n) => n.palmMute)).toBe(true)
    expect(on(2, 3)[0].palmMute).toBe(true)
  })

  it('reads tapping: "t" before the tapped fret', () => {
    const notes = notesOf(parseTextTab('e|-5h7t12p7-t14--|\nB|---------------|', 2, ts))
    expect(notes.map((n) => [n.fret, !!n.tap, n.legato])).toEqual([[5, false, 'h'], [7, false, undefined], [12, true, 'p'], [7, false, undefined], [14, true, undefined]])
    const tapped = { kind: 'tab' as const, version: 1 as const, measures: parseTextTab('e|-t12p7~---t/9--|', 1, ts).measures }
    const back = notesOf(parseTextTab(tabToText(tapped, std.slice(0, 1)), 1, ts))
    expect(back.map((n) => [n.fret, !!n.tap, n.legato, n.vibrato, n.slide])).toEqual([[12, true, 'p', undefined, undefined], [7, false, undefined, true, undefined], [9, true, undefined, undefined, 'inBelow']])
  })

  it('keeps natural <n> and artificial [n] harmonics apart, both ways', () => {
    const r = parseTextTab('e|-<12>-[7]--|', 1, ts)
    expect(notesOf(r).map((n) => [n.fret, n.harmonic])).toEqual([[12, 'natural'], [7, 'artificial']])
    const back = notesOf(parseTextTab(tabToText({ kind: 'tab', version: 1, measures: r.measures }, std.slice(0, 1)), 1, ts))
    expect(back.map((n) => [n.fret, n.harmonic])).toEqual([[12, 'natural'], [7, 'artificial']])
  })

  it('ignores non-TAB text and maps blocks with fewer strings', () => {
    const r = parseTextTab('Verse:\nG|--5--|\nD|--5--|\nA|--3--|\nE|-----|\nlyrics here', 6, ts)
    expect(r.blockStrings).toEqual([4])
    expect(notesOf(r).map((n) => n.string)).toEqual([1, 2, 3])
    expect(parseTextTab('just some words', 6, ts).measures).toHaveLength(0)
  })
})

describe('tabToText round trip', () => {
  it('keeps notes, techniques and rhythm', () => {
    const src = `PM------
e|-------0-------|
B|-3h5-----------|
G|---------7b9r7-|
D|-<5>-----------|
A|-----------x---|
E|-0-------------|`
    const first = parseTextTab(src, 6, ts)
    const text = tabToText({ kind: 'tab', version: 1, measures: first.measures }, std)
    expect(text.split('\n')[1].startsWith('e|')).toBe(true)
    const second = parseTextTab(text, 6, ts)
    const sig = (r: typeof first) =>
      notesOf(r)
        .map((n) => JSON.stringify(n))
        .sort()
    expect(sig(second)).toEqual(sig(first))
    expect(second.measures.map((m) => m.beats.map((b) => b.duration))).toEqual(first.measures.map((m) => m.beats.map((b) => b.duration)))
  })
})
