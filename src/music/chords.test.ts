import { describe, expect, it } from 'vitest'
import { chordDegree, findVoicings, keyTonic, parseChord, scaleDegree, voicingLabel } from './chords'

const std = [64, 59, 55, 50, 45, 40]
const tones = (name: string) => {
  const c = parseChord(name)!
  return [...c.degrees.entries()].sort((a, b) => a[0] - b[0]).map(([i, d]) => `${i}:${d}`).join(' ')
}

describe('parseChord', () => {
  it('reads qualities and extensions', () => {
    expect(tones('C')).toBe('0:R 4:3 7:5')
    expect(tones('Am')).toBe('0:R 3:♭3 7:5')
    expect(tones('G7')).toBe('0:R 4:3 7:5 10:♭7')
    expect(tones('Fmaj7')).toBe('0:R 4:3 7:5 11:7')
    expect(tones('CΔ')).toBe('0:R 4:3 7:5 11:7')
    expect(tones('Bm7b5')).toBe('0:R 3:♭3 6:♭5 10:♭7')
    expect(tones('Bø')).toBe('0:R 3:♭3 6:♭5 10:♭7')
    expect(tones('Cdim7')).toBe('0:R 3:♭3 6:♭5 9:𝄫7')
    expect(tones('Caug')).toBe('0:R 4:3 8:♯5')
    expect(tones('Dsus4')).toBe('0:R 5:4 7:5')
    expect(tones('Dsus2')).toBe('0:R 2:2 7:5')
    expect(tones('E5')).toBe('0:R 7:5')
    expect(tones('C6')).toBe('0:R 4:3 7:5 9:6')
    expect(tones('Cm9')).toBe('0:R 2:9 3:♭3 7:5 10:♭7')
    expect(tones('Cadd9')).toBe('0:R 2:9 4:3 7:5')
    expect(tones('G7#9')).toBe('0:R 3:♯9 4:3 7:5 10:♭7')
    expect(tones('CmMaj7')).toBe('0:R 3:♭3 7:5 11:7')
    expect(parseChord('C/G')!.bass).toBe(7)
    expect(parseChord('F#m')!.root).toBe(6)
    expect(parseChord('Bb7')!.root).toBe(10)
    expect(parseChord('Hello')).toBeNull()
    expect(parseChord('Cxyz')).toBeNull()
  })

  it('labels degrees', () => {
    const am7 = parseChord('Am7')!
    expect(chordDegree(57, am7)).toBe('R') // A3
    expect(chordDegree(60, am7)).toBe('♭3') // C4
    expect(chordDegree(67, am7)).toBe('♭7') // G4
    expect(chordDegree(59, am7)).toBe('2') // B, not a chord tone
    expect(scaleDegree(64, keyTonic('C'))).toBe('3')
    expect(scaleDegree(66, keyTonic('C'))).toBe('♯4')
    expect(scaleDegree(69, keyTonic('Am'))).toBe('6') // A minor uses 1=C
    expect(scaleDegree(62, keyTonic('D'))).toBe('1')
  })
})

describe('findVoicings', () => {
  it('finds the common open shapes in standard tuning', () => {
    const labels = (name: string) => findVoicings(parseChord(name)!, std, 24).map(voicingLabel)
    expect(labels('C')).toContain('x32010')
    expect(labels('G')).toContain('320003')
    expect(labels('Am')).toContain('x02210')
    expect(labels('E')).toContain('022100')
    expect(labels('D')).toContain('xx0232')
    expect(labels('C/G')[0].startsWith('3')).toBe(true)
  })

  it('works for other tunings and string counts', () => {
    const bass = [43, 38, 33, 28] // G D A E
    const v = findVoicings(parseChord('A')!, bass, 24)
    expect(v.length).toBeGreaterThan(0)
    const uke = [69, 64, 60, 67] // A E C G (re-entrant)
    expect(findVoicings(parseChord('C')!, uke, 18).map(voicingLabel)).toContain('0003')
  })
})
