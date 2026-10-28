import { describe, expect, it } from 'vitest'
import * as at from '@coderline/alphatab'
import { melodyToAlphaTex } from './alphatex'
import {
  degreeToMidi, emptyMelody, letterToMidi, numberedBase, previousPitch, setPitch, shiftOctave, shiftSemitone,
  spelledName, suggestPositions, toNumbered, toggleMelodyTie, transposeMelody,
} from './melody'
import { setChord, setLyric, toggleDot } from './rhythm'

const guitar = [64, 59, 55, 50, 45, 40]
const ts: [number, number] = [4, 4]

describe('numbered notation', () => {
  it('picks a base octave inside the instrument range', () => {
    expect(numberedBase(guitar, 'C')).toBe(48) // C3
    expect(numberedBase(guitar, 'G')).toBe(55) // G3
    expect(numberedBase([67, 64, 60, 69].sort((a, b) => b - a), 'C')).toBe(60) // ukulele: C4
  })

  it('converts pitches to digits, accidentals and octave dots', () => {
    const g = (midi: number, sp: 'sharp' | 'flat' = 'sharp') => {
      const n = toNumbered(midi, 48, sp)
      return `${n.accidental}${n.digit}${n.octave > 0 ? "'".repeat(n.octave) : ','.repeat(-n.octave)}`
    }
    expect([48, 50, 52, 53, 55, 57, 59].map((m) => g(m))).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(g(60)).toBe("1'")
    expect(g(47)).toBe('7,')
    expect(g(54)).toBe('♯4')
    expect(g(54, 'flat')).toBe('♭5')
    expect(g(58, 'flat')).toBe('♭7')
    expect(toNumbered(51, 48).accidental + toNumbered(51, 48).digit).toBe('♭3') // conventional without a spelling
    expect(toNumbered(58, 48).accidental + toNumbered(58, 48).digit).toBe('♭7')
    expect(toNumbered(54, 48).accidental + toNumbered(54, 48).digit).toBe('♯4')
    expect(degreeToMidi(5, 48)).toBe(55)
    expect(degreeToMidi(5, 48, 48)).toBe(55) // same row as the previous note: up from 1 to 5
    expect(degreeToMidi(1, 48, 60)).toBe(60) // previous note in the dotted-above row
    expect(letterToMidi('b', 61)).toBe(59)
    expect(spelledName(61, 'flat')).toBe('D♭4')
  })
})

describe('melody edits', () => {
  it('sets, shifts and ties pitches', () => {
    let c = setPitch(emptyMelody(ts), 0, 0, 60)
    c = shiftSemitone(c, 0, 0, 1)
    expect(c.measures[0].beats[0].notes[0]).toEqual({ midi: 61, spelling: 'sharp' })
    c = shiftOctave(c, 0, 0, -1)
    expect(c.measures[0].beats[0].notes[0].midi).toBe(49)
    expect(previousPitch(c, { m: 0, b: 2, s: 1 })).toBe(49)
    c = toggleMelodyTie(c, { m: 0, b: 1, s: 1 })
    expect(c.measures[0].beats[1].notes[0]).toEqual({ midi: 49, spelling: 'sharp', tie: true })
    expect(transposeMelody(c, 2).measures[0].beats[0].notes[0].midi).toBe(51)
  })

  it('suggests one position per pitch inside a common box', () => {
    // G major scale from G2: fits the box around frets 2–6 better than open position for these notes.
    const pitches = [43, 45, 47, 48, 50, 52, 54, 55]
    const pos = suggestPositions(pitches, guitar, 24)
    expect(pos.size).toBe(8)
    const fretsUsed = [...pos.values()].map((p) => p.fret)
    expect(Math.max(...fretsUsed) - Math.min(...fretsUsed.filter((f) => f > 0))).toBeLessThanOrEqual(4)
  })
})

describe('melodyToAlphaTex', () => {
  it('renders pitches, ties, chords, lyrics and key', () => {
    let c = setPitch(emptyMelody(ts), 0, 0, 52)
    c = toggleMelodyTie(c, { m: 0, b: 1, s: 1 })
    c = setPitch(c, 0, 2, 54)
    c = setChord(setLyric(toggleDot(c, 0, 0), 0, 0, '我'), 0, 0, 'Em')
    const tex = melodyToAlphaTex(c, { title: 't', tempo: 90, timeSignature: ts, key: 'G', clef: 'treble8', program: 25 })
    const score = at.importer.ScoreLoader.loadAlphaTex(tex)
    const staff = score.tracks[0].staves[0]
    const beats = staff.bars[0].voices[0].beats
    expect(beats[0].notes[0].realValue).toBe(52)
    expect(beats[0].lyrics).toEqual(['我'])
    expect(beats[0].chord?.name).toBe('Em')
    expect(beats[0].dots).toBe(1)
    expect(beats[1].notes[0].isTieDestination).toBe(true)
    expect(beats[2].notes[0].realValue).toBe(54)
    expect(score.masterBars[0].keySignature).toBe(1)
    expect(staff.displayTranspositionPitch).toBe(-12)
    expect(score.tracks[0].playbackInfo.program).toBe(25)
  })
})

describe('conversions', async () => {
  const { tabToMelody, melodyToTab, toChordChart, convertContent } = await import('./convert')
  const { emptyTab, setNote } = await import('./tab')
  it('TAB ↔ melody keeps pitches and rhythm', () => {
    let tab = setNote(emptyTab(ts), { m: 0, b: 0, s: 6 }, 3) // G2
    tab = setNote(tab, { m: 0, b: 0, s: 1 }, 0) // E4 (top note of the chord)
    tab = setNote(tab, { m: 0, b: 1, s: 5 }, 2) // B2
    const mel = tabToMelody(tab, guitar)
    expect(mel.measures[0].beats.slice(0, 3).map((b) => b.notes[0]?.midi)).toEqual([64, 47, undefined])
    const back = melodyToTab(mel, guitar, 24)
    const pitch = (n: { string: number; fret: number }) => guitar[n.string - 1] + n.fret
    expect(back.measures[0].beats.slice(0, 2).map((b) => pitch(b.notes[0]))).toEqual([64, 47])
  })
  it('builds a chord chart from chords and lyrics', () => {
    let mel = setChord(setLyric(setPitch(emptyMelody(ts), 0, 0, 60), 0, 0, '我'), 0, 0, 'C')
    mel = setChord(setLyric(setPitch(mel, 1, 0, 62), 1, 0, '們'), 1, 0, 'G')
    expect(toChordChart(mel).text).toBe('[C]我 | [G]們')
    expect(convertContent(emptyMelody(ts), 'chords', guitar, 24)).toBeNull()
  })
})
