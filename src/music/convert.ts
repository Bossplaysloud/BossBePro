// Converting content between notation types.

import type { SheetType } from '../db/db'
import { emptyChordChart, isChordChartContent, type ChordChartContent } from './chordChart'
import { isMelodyContent, positionsFor, suggestPositions, type MelodyContent, type MelodyNote } from './melody'
import type { Content } from './rhythm'
import { isTabContent, type TabContent, type TabNote } from './tab'

export type ContentKind = 'tab' | 'melody' | 'chords'

export function kindOf(type: SheetType): ContentKind {
  return type === 'tab' ? 'tab' : type === 'chord' ? 'chords' : 'melody'
}

export function contentKind(content: unknown): ContentKind | null {
  if (isTabContent(content)) return 'tab'
  if (isMelodyContent(content)) return 'melody'
  if (isChordChartContent(content)) return 'chords'
  return null
}

/** TAB → melody: each beat keeps its highest sounding note (the melody line). */
export function tabToMelody(tab: TabContent, tuning: number[]): MelodyContent {
  return {
    kind: 'melody',
    version: 1,
    measures: tab.measures.map((m) => ({
      ...m,
      voice2: undefined,
      beats: m.beats.map((b) => {
        const pitched = b.notes.filter((n) => !n.dead && n.string <= tuning.length)
        const top = pitched.sort((x, y) => tuning[y.string - 1] + y.fret - (tuning[x.string - 1] + x.fret))[0]
        const notes: MelodyNote[] = top ? [{ midi: tuning[top.string - 1] + top.fret, ...(top.tie ? { tie: true } : {}) }] : []
        return { ...b, notes }
      }),
    })),
  }
}

/** Melody → TAB: places each note near the previous one, starting from the best-fitting hand position. */
export function melodyToTab(melody: MelodyContent, tuning: number[], frets: number): TabContent {
  const pitches = melody.measures.flatMap((m) => m.beats.flatMap((b) => b.notes.map((n) => n.midi)))
  const box = suggestPositions(pitches, tuning, frets)
  let prevFret = [...box.values()][0]?.fret ?? 0
  let prev: TabNote | null = null
  return {
    kind: 'tab',
    version: 1,
    // The second voice has no place in single-voice TAB; it is dropped.
    measures: melody.measures.map((m) => ({
      ...m,
      voice2: undefined,
      beats: m.beats.map((b) => {
        const n = b.notes[0]
        if (!n) return { ...b, notes: [] }
        if (n.tie && prev) return { ...b, notes: [{ string: prev.string, fret: prev.fret, tie: true }] }
        const options = positionsFor(n.midi, tuning, frets)
        if (!options.length) return { ...b, notes: [] }
        const suggested = box.get(n.midi)
        const best = options.sort((x, y) => Math.abs(x.fret - prevFret) - Math.abs(y.fret - prevFret) || (suggested && x.string === suggested.string ? -1 : 0))[0]
        prevFret = best.fret || prevFret
        prev = { string: best.string, fret: best.fret }
        return { ...b, notes: [prev] }
      }),
    })),
  }
}

/** TAB or melody → chord chart: one line per four bars with chord names (and lyrics, if any). */
export function toChordChart(content: Content): ChordChartContent {
  const lines: string[] = []
  for (let i = 0; i < content.measures.length; i += 4) {
    const parts = content.measures.slice(i, i + 4).map((m) =>
      m.beats
        .map((b) => `${b.chord ? `[${b.chord}]` : ''}${b.lyric ?? ''}`)
        .join('')
        .trim(),
    )
    const line = parts.filter(Boolean).join(' | ')
    if (line) lines.push(line)
  }
  return { ...emptyChordChart(), text: lines.join('\n') }
}

/** Converts content for a new kind, or null when there is nothing sensible to convert. */
export function convertContent(content: unknown, to: ContentKind, tuning: number[], frets: number): unknown {
  const from = contentKind(content)
  if (!from || from === to) return from ? content : null
  if (from === 'tab' && to === 'melody') return tabToMelody(content as TabContent, tuning)
  if (from === 'melody' && to === 'tab') return melodyToTab(content as MelodyContent, tuning, frets)
  if (to === 'chords' && from !== 'chords') {
    const chart = toChordChart(content as Content)
    return chart.text ? chart : null
  }
  return null
}
