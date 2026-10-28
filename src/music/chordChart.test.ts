import { describe, expect, it } from 'vitest'
import { chartChords, chordsAboveToInline, detectCapo, emptyChordChart, parseChart, transposeChart, transposeChordName, transposeContent } from './chordChart'
import { transposeKey } from './chords'

describe('chord charts', () => {
  it('parses chords, sections and comments', () => {
    const lines = parseChart('[Verse]\n[Am]我們的[F]故事\n# capo 2\n\n[C] [G]')
    expect(lines[0]).toEqual({ type: 'section', label: 'Verse' })
    expect(lines[1]).toEqual({ type: 'lyric', segments: [{ chord: 'Am', text: '我們的' }, { chord: 'F', text: '故事' }] })
    expect(lines[2]).toEqual({ type: 'comment', text: 'capo 2' })
    expect(lines[3]).toEqual({ type: 'blank' })
    expect(lines[4]).toEqual({ type: 'lyric', segments: [{ chord: 'C', text: ' ' }, { chord: 'G', text: '' }] })
    expect(parseChart('前奏 [C]啦')[0]).toEqual({ type: 'lyric', segments: [{ text: '前奏 ' }, { chord: 'C', text: '啦' }] })
    expect(chartChords('[Am]a [F]b [Am]c [Chorus]')).toEqual(['Am', 'F'])
  })

  it('transposes chords but not section labels', () => {
    expect(transposeChordName('Am7', 2, false)).toBe('Bm7')
    expect(transposeChordName('C/G', -1, true)).toBe('B/Gb')
    expect(transposeChordName('F#m7b5', 1, false)).toBe('Gm7b5')
    expect(transposeChart('[Verse]\n[C]la [G/B]la', 2)).toBe('[Verse]\n[D]la [A/C#]la')
  })

  it('converts chords written above the lyrics', () => {
    const text = 'C       G\nHello there world\nAm  F\n我們的故事'
    expect(chordsAboveToInline(text)).toBe('[C]Hello th[G]ere world\n[Am]我們[F]的故事')
    expect(chordsAboveToInline('Am         F\n一起走過的路')).toBe('[Am]一起走過的[F]路')
    expect(chordsAboveToInline('[C]already inline')).toBe('[C]already inline')
    expect(chordsAboveToInline('Intro: no chords')).toBe('Intro: no chords')
    expect(chordsAboveToInline('C  G  Am\n\nnext')).toBe('[C] [G] [Am]\n\nnext')
  })
  it('tracks the transposition amount and finds capo notes', () => {
    let c = { ...emptyChordChart(), text: '[C]la' }
    c = transposeContent(transposeContent(c, 1), 1)
    expect(c).toMatchObject({ text: '[D]la', transpose: 2 })
    c = transposeContent(c, -2)
    expect(c.transpose).toBe(0)
    expect(transposeContent({ ...c, transpose: 6 }, 1).transpose).toBe(-5)
    expect(detectCapo('# Capo 2')).toBe(2)
    expect(detectCapo('移調夾：3')).toBe(3)
    expect(detectCapo('no capo here')).toBeNull()
    expect(transposeKey('G', 2)).toBe('A')
    expect(transposeKey('Am', -1)).toBe('G#m')
    expect(transposeKey('C', -1)).toBe('B')
  })
})
