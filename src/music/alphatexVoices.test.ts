import * as at from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { melodyToAlphaTex } from './alphatex'
import type { MelodyContent } from './melody'

describe('staff with two voices', () => {
  it('writes chords, fingering, ties and a second voice that alphaTab reads', () => {
    const c: MelodyContent = {
      kind: 'melody',
      version: 1,
      measures: [
        { id: 'a', beats: [{ id: '1', duration: 4, notes: [{ midi: 60, finger: 1 }, { midi: 64 }] }, { id: '2', duration: 2, notes: [{ midi: 67 }] }], voice2: [{ id: '3', duration: 2, dotted: true, notes: [{ midi: 45 }] }] },
        { id: 'b', beats: [{ id: '4', duration: 2, dotted: true, notes: [{ midi: 67, tie: true }] }] },
        { id: 'c', beats: [{ id: '5', duration: 8, grace: true, notes: [{ midi: 69 }] }, { id: '6', duration: 2, dotted: true, notes: [{ midi: 67 }] }] },
      ],
    }
    const tex = melodyToAlphaTex(c, { title: 't', tempo: 80, timeSignature: [3, 4], key: 'C', clef: 'treble8' })
    const score = at.importer.ScoreLoader.loadAlphaTex(tex)
    const [bar1, bar2] = score.tracks[0].staves[0].bars
    expect(bar1.voices).toHaveLength(2)
    expect(bar1.voices[0].beats[0].notes).toHaveLength(2)
    expect(bar1.voices[1].beats[0].notes[0].realValue).toBe(45)
    expect(bar2.voices[1].beats.every((b) => b.isRest)).toBe(true)
    expect(bar2.voices[0].beats[0].notes[0].isTieDestination).toBe(true)
    const bar3 = score.tracks[0].staves[0].bars[2]
    expect(bar3.voices[0].beats[0].graceType).not.toBe(0)
  })
})
