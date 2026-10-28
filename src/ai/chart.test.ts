import { describe, expect, it } from 'vitest'
import { chartTextFromSections, dropDashFillers, parseChart, transposeChart } from '../music/chordChart'
import { tidyChart } from '../music/tidy'
import { emptyChart, type Recognition, type RecognizedChart } from './schema'
import { toImportedSheet } from './toContent'

const seg = (chord: string | null, lyric = '') => ({ chord, lyric })
const beat = (...symbols: [string, '4' | '8' | '16' | '32'][]) => ({ symbols: symbols.map(([text, duration]) => ({ text, duration, dotted: false })), barAfter: false })
const line = (bars: ReturnType<typeof seg>[][], repeat: string | null = null, note: string | null = null) => ({ bars: bars.map((segments) => ({ segments })), repeat, note })

/** What a correct bar-by-bar transcription of the user's "不是因為天氣晴朗才愛你" chart looks like. */
const chart: RecognizedChart = {
  ...emptyChart(),
  originalKey: 'Ab',
  writtenKey: 'G',
  maleKey: 'Ab',
  femaleKey: 'Eb',
  patterns: [
    { label: '指法', beats: [beat(['T', '8'], ['1', '8']), beat(['2', '8'], ['1', '8']), beat(['T', '8'], ['1', '8']), beat(['2', '8'], ['1', '8'])] },
    // "X ↑↑↓": one line under ↑↑↓ and a second under ↑↓ → ↑ eighth, ↑↓ sixteenths
    { label: '刷法', beats: [beat(['X', '4']), beat(['↑', '8'], ['↑', '16'], ['↓', '16']), beat(['X', '4']), beat(['↑', '8'], ['↑', '16'], ['↓', '16'])] },
  ],
  sections: [
    { label: '前奏', lines: [line([[seg('G')], [seg('D/F#')], [seg('Cmaj7')], [seg('D11')]], 'x2')] },
    {
      label: null,
      lines: [
        line([
          [seg('G', '▲不是'), seg('D/F#', '因為天氣晴')],
          [seg('Em', '朗才愛你 ')],
          [seg('C', '不是 '), seg('G/B', '因為 ')],
          [seg('Cm7', '看見星星才'), seg('D', '想你')],
        ]),
      ],
    },
    { label: '間奏1', lines: [line([[seg('G')], [seg('D/F#')], [seg('Cmaj7')], [seg('D11')]], null, '(回▲)')] },
  ],
}

const rec: Recognition = {
  notation: 'chord', title: '不是因為天氣晴朗才愛你', strings: null, tuning: null, key: 'Ab', timeSignature: '4/4', tempo: 68, capo: null,
  measures: [], chart, warnings: [],
}

describe('chord chart recognition', () => {
  it('builds aligned text, bar lines and sections, and works out the capo', () => {
    const s = toImportedSheet(rec, 'x')
    expect(s.type).toBe('chord')
    expect(s.key).toBe('G') // the chart is written in G…
    const content = s.content as { text: string; capo?: number; meta?: Record<string, unknown> }
    expect(content.capo).toBe(1) // …and the song is in Ab: capo 1
    expect(content.meta).toEqual({ originalKey: 'Ab', maleKey: 'Ab', femaleKey: 'Eb', tempo: 68, timeSignature: '4/4' })
    expect(content.text.split('\n')).toEqual([
      '[指法] T1 21 T1 21',
      '[刷法] X ↑_↑__↓__ X ↑_↑__↓__',
      '',
      '[前奏]',
      '| [G] | [D/F#] | [Cmaj7] | [D11] | x2',
      '',
      '[G]▲不是[D/F#]因為天氣晴[Em]朗才愛你 [C]不是 [G/B]因為 [Cm7]看見星星才[D]想你',
      '',
      '[間奏1]',
      '| [G] | [D/F#] | [Cmaj7] | [D11] | (回▲)',
    ])
  })

  it('parses bar lines (also with a heading on the same line) and transposes them', () => {
    const bar = (...chords: string[]) => ({ type: 'bar', chords })
    const lines = parseChart('[前奏] ||G |D/F# |Cmaj7 |D11 || x2\n| [C] [G/B] | [Cm7] [D] |\n[尾奏] ||G |D/F# |Cmaj7 |D11 || x 2 |C |G |')
    expect(lines[0]).toEqual({ type: 'section', label: '前奏' })
    expect(lines[1]).toEqual({ type: 'bars', items: [bar('G'), bar('D/F#'), bar('Cmaj7'), bar('D11'), { type: 'mark', text: 'x2' }] })
    expect(lines[2]).toEqual({ type: 'bars', items: [bar('C', 'G/B'), bar('Cm7', 'D')] })
    // x2 in the middle of the line stays in place
    expect(lines[4]).toEqual({ type: 'bars', items: [bar('G'), bar('D/F#'), bar('Cmaj7'), bar('D11'), { type: 'mark', text: 'x2' }, bar('C'), bar('G')] })
    expect(transposeChart('| G | D/F# | x2\n| [G] | [C] |\n[G]我', 2)).toBe('| A | E/G# | x2\n| [A] | [D] |\n[A]我')
  })

  it('reads headings with brackets inside and rhythm patterns', () => {
    expect(parseChart('[(1) [間奏1]]')).toEqual([{ type: 'section', label: '(1) 間奏1' }])
    expect(parseChart('[C] [G]')[0].type).toBe('lyric') // a run of chords is not a heading
    expect(parseChart('[Am]我們[F]')[0].type).toBe('lyric')
    const [p] = parseChart('[指法] T1 21 T1 21 | ↓_↑__↑__ 123')
    expect(p.type).toBe('pattern')
    if (p.type !== 'pattern') return
    expect(p.label).toBe('指法')
    expect(p.beats[0]).toEqual({ symbols: [{ text: 'T', lines: 1 }, { text: '1', lines: 1 }] })
    expect(p.beats[4]).toBe('|')
    expect(p.beats[5]).toEqual({ symbols: [{ text: '↓', lines: 1 }, { text: '↑', lines: 2 }, { text: '↑', lines: 2 }] })
    expect(p.beats[6]).toEqual({ symbols: [{ text: '1', lines: 1 }, { text: '2', lines: 1 }, { text: '3', lines: 1 }], tuplet: 3 })
    expect(parseChart('# 刷法：X ↑↓')[0].type).toBe('pattern') // older form still reads as a pattern
    const lines = (text: string) => {
      const [q] = parseChart(`[刷法] ${text}`)
      return q.type === 'pattern' ? q.beats.map((b) => (b === '|' ? '|' : b.symbols.map((x) => `${x.text}${x.lines}${x.dotted ? '.' : ''}`).join(' '))) : []
    }
    // The AI's incomplete "↑_↑↓": the unmarked ↑↓ share the remaining half beat → sixteenths
    expect(lines('X ↑_↑↓')).toEqual(['X0', '↑1 ↑2 ↓2'])
    expect(lines('X ↑_↑__↓__')).toEqual(['X0', '↑1 ↑2 ↓2'])
    expect(lines('↓_.↑__')).toEqual(['↓1. ↑2']) // dotted eighth + sixteenth
  })

  it('tidies older text into the current format', () => {
    expect(tidyChart({ kind: 'chords', version: 1, text: '[刷法] X ↑_↑↓ X ↑_↑↓ | 123' }).content.text).toBe('[刷法] X ↑_↑__↓__ X ↑_↑__↓__ | 123')
    const { content } = tidyChart({ kind: 'chords', version: 1, text: '# 指法：T1 21\n[(1) [間奏1]]\n| G | D/F# | (回▲)\n[尾奏] ||G |D11 || x 2 |C |' })
    expect(content.text).toBe('[指法] T1 21\n[(1) 間奏1]\n| [G] | [D/F#] | (回▲)\n[尾奏]\n| [G] | [D11] | x2 | [C] |')
  })

  it('repairs the broken output seen in the first version', () => {
    const { content, report } = tidyChart({ kind: 'chords', version: 1, text: '[G][G][D/F#]▲不是[Em]因為[C][D/[G/B]F#][Cm7]天氣晴' })
    expect(content.text).toBe('[G][D/F#]▲不是[Em]因為[C][D/F#][G/B][Cm7]天氣晴')
    expect(report.repaired).toBe(2)
  })
})

describe('rhythm patterns with silent steps', () => {
  it('keeps "-" as a timed step and fixes beats that do not add up', async () => {
    const { fitBeat } = await import('./toContent')
    const sym = (text: string, d: number) => ({ text, duration: d, dotted: false })
    // "↑--↓" as four sixteenths stays
    expect(fitBeat([sym('↑', 16), sym('-', 16), sym('-', 16), sym('↓', 16)]).map((s) => s.duration)).toEqual([16, 16, 16, 16])
    // values that add up to 3/4 of a beat are evened out
    expect(fitBeat([sym('↓', 8), sym('↑', 16), sym('↓', 16), sym('↑', 16)]).map((s) => s.duration)).toEqual([16, 16, 16, 16])
    const [p] = parseChart('[刷法] X ↑--↓ -↓↑↓ ↑-↑↓')
    if (p.type !== 'pattern') throw new Error('pattern expected')
    expect(p.beats.map((b) => (b === '|' ? '|' : b.symbols.map((s) => `${s.text}${s.lines}`).join(' ')))).toEqual(['X0', '↑2 -2 -2 ↓2', '-2 ↓2 ↑2 ↓2', '↑2 -2 ↑2 ↓2'])
  })

  it('writes the pattern from the AI beats', () => {
    const b = (...xs: [string, '4' | '8' | '16'][]) => ({ symbols: xs.map(([text, duration]) => ({ text, duration, dotted: false })), barAfter: false })
    const r: Recognition = {
      ...rec,
      chart: { ...chart, patterns: [{ label: '刷法', beats: [b(['X', '4']), b(['↑', '16'], ['-', '16'], ['-', '16'], ['↓', '16']), b(['-', '16'], ['↓', '16'], ['↑', '16'], ['↓', '16']), b(['↑', '16'], ['-', '16'], ['↑', '16'], ['↓', '16'])] }] },
    }
    const text = (toImportedSheet(r, 'x').content as { text: string }).text
    expect(text.split('\n')[0]).toBe('[刷法] X ↑--↓ -↓↑↓ ↑-↑↓')
  })
})

describe('chord positions', () => {
  // "|D        |F#m/C#   |F#m |" over "★或許我沒有你以為的  那麼勇敢" (positions 0–1000 across the image)
  const at = (chord: string | null, lyric: string, x: number | null) => ({ chord, lyric, x })
  const placed = (bars: ReturnType<typeof at>[][], lyricStart: number | null = 13, lyricEnd: number | null = 317) => ({ bars: bars.map((segments) => ({ segments })), repeat: null, note: null, lyricStart, lyricEnd })
  const text = (l: ReturnType<typeof placed>) => chartTextFromSections([{ label: null, lines: [l] }], (c) => c)

  it('moves chords stacked before the words to where they are printed', () => {
    const stacked = placed([[at('D', '', 13)], [at('F#m/C#', '', 175)], [at('F#m', '★或許我沒有你以為的  那麼勇敢', 313)]])
    expect(text(stacked)).toBe('[D]★或許我沒有你以[F#m/C#]為的  那麼勇[F#m]敢')
  })

  it('moves a chord written after the words back over its character', () => {
    // "|G        A   |" over "不能成為你  堅實的靠山": A sits over 實
    const late = placed([[at('G', '不能成為你  堅實的靠山', 30), at('A', '', 168)]], 30, 246)
    expect(text(late)).toBe('[G]不能成為你  堅[A]實的靠山')
  })

  it('keeps a transcription that agrees with the positions', () => {
    const good = placed([[at('D', '★或許我沒有你以', 13)], [at('F#m/C#', '為的  那麼勇', 180)], [at('F#m', '敢', 313)]])
    expect(text(good)).toBe('[D]★或許我沒有你以[F#m/C#]為的  那麼勇[F#m]敢')
    expect(text(placed([[at('D', '', null)], [at('A', '你好', null)]]))).toBe('[D][A]你好')
  })

  it('drops beat fillers copied into the lyrics', () => {
    expect(dropDashFillers('無力承-- --   擔')).toBe('無力承    擔')
    expect(dropDashFillers('rock-n-roll')).toBe('rock-n-roll')
  })
})

describe('groups after an interlude', () => {
  it('keeps the sung lines after "[間奏1] | D A/C# | Bm7 | G |" as their own group with lyrics', () => {
    const text = chartTextFromSections(
      [
        { label: '(1) 間奏1', lines: [line([[seg('D'), seg('A/C#')], [seg('Bm7')], [seg('G')]])] },
        { label: null, lines: [line([[seg(null, '陪著我慢慢'), seg('G', '好起來  ')], [seg('Gm6', '陪著我慢慢好')]])] },
      ],
      (c) => c,
    )
    expect(text).toBe('[(1) 間奏1]\n| [D] [A/C#] | [Bm7] | [G] |\n\n陪著我慢慢[G]好起來  [Gm6]陪著我慢慢好')
  })
})

describe('chord row and lyric row returned apart', () => {
  const at = (chord: string | null, lyric = '', x: number | null = null) => ({ chord, lyric, x })
  const row = (bars: ReturnType<typeof at>[][], lyricStart: number | null = null, lyricEnd: number | null = null) => ({ bars: bars.map((segments) => ({ segments })), repeat: null, note: null, lyricStart, lyricEnd })

  it('joins them, across a group break, using the printed positions', () => {
    const text = chartTextFromSections(
      [
        { label: '(1) 間奏1', lines: [row([[at('D'), at('A/C#')], [at('Bm7')], [at('G')]])] },
        // "|G       |Gm6        |" over "陪著我慢慢好起來  陪著我慢慢好"
        { label: null, lines: [row([[at('G', '', 140)], [at('Gm6', '', 225)]])] },
        { label: null, lines: [row([[at(null, '陪著我慢慢好起來  陪著我慢慢好')]], 30, 350)] },
      ],
      (c) => c,
    )
    expect(text).toBe('[(1) 間奏1]\n| [D] [A/C#] | [Bm7] | [G] |\n\n陪著我慢慢[G]好起來  [Gm6]陪著我慢慢好')
  })

  it('spreads the bars evenly when positions are missing', () => {
    const text = chartTextFromSections([{ label: null, lines: [row([[at('Bm7')], [at('A')]]), row([[at(null, '這樣渺小的我')]])] }], (c) => c)
    expect(text).toBe('[Bm7]這樣渺[A]小的我')
  })

  it('leaves an interlude with a repeat mark alone', () => {
    const intro = { ...row([[at('G')], [at('D')]]), repeat: 'x2' }
    const text = chartTextFromSections([{ label: '前奏', lines: [intro] }, { label: null, lines: [row([[at(null, '啦啦啦')]])] }], (c) => c)
    expect(text).toBe('[前奏]\n| [G] | [D] | x2\n\n啦啦啦')
  })
})

describe('section names inside lines', () => {
  const at = (chord: string | null, lyric = '') => ({ chord, lyric, x: null })
  const row = (bars: ReturnType<typeof at>[][]) => ({ bars: bars.map((segments) => ({ segments })), repeat: null, note: null, lyricStart: null, lyricEnd: null })

  it('lifts names out of the lyrics and joins "(1)" with the name after it', () => {
    const text = chartTextFromSections(
      [
        { label: '(1)', lines: [] },
        { label: '間奏1', lines: [row([[at('D'), at('A/C#')], [at('Bm7')], [at('G')]])] },
        { label: null, lines: [row([[at(null, '[間奏2] '), at('D')], [at('F#m/C#')]]), row([[at(null, '起來')]])] },
        { label: null, lines: [row([[at(null, '(2) [間奏3]')]]), row([[at('D'), at('A/C#')], [at('Bm7'), at('D/A')]])] },
      ],
      (c) => c,
    )
    expect(text).toBe('[(1) 間奏1]\n| [D] [A/C#] | [Bm7] | [G] |\n\n[間奏2]\n[D]起[F#m/C#]來\n\n[(2) 間奏3]\n| [D] [A/C#] | [Bm7] [D/A] |')
  })

  it('tidies charts already saved that way', () => {
    const saved = '[(1)]\n\n[間奏1]\n| [D] [A/C#] | [Bm7] | [G] |\n\n[間奏2] [D][F#m/C#][Bm7][G][A]\n\n起來\n\n(2) [間奏3]\n\n| [D] | [Bm7] |\n\n[前奏]\n| [G] | [D] | x2\n\n[G]啦啦'
    expect(tidyChart({ kind: 'chords', version: 1, text: saved }).content.text).toBe(
      '[(1) 間奏1]\n| [D] [A/C#] | [Bm7] | [G] |\n\n[間奏2]\n[D][F#m/C#]起[Bm7][G][A]來\n\n[(2) 間奏3]\n\n| [D] | [Bm7] |\n\n[前奏]\n| [G] | [D] | x2\n\n[G]啦啦',
    )
  })
})
