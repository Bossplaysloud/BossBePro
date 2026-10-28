import { describe, expect, it } from 'vitest'
import * as at from '@coderline/alphatab'
import { convertTrack, keyName, listTracks, trackTitle } from './gpImport'
import type { MelodyContent } from './melody'
import { measureFill, tsAt } from './rhythm'
import type { TabContent } from './tab'

const load = (tex: string) => at.importer.ScoreLoader.loadAlphaTex(tex)
const tabOf = (tex: string, track = 0) => {
  const score = load(tex)
  const sheet = convertTrack(score, track, 'Song')
  return { sheet, content: sheet.content as TabContent }
}
const GTR = '\\track "Gtr" \\tuning (E4 B3 G3 D3 A2 E2)'

describe('GP import', () => {
  it('lists tracks with their kind, tuning and instrument', () => {
    const score = load(`\\title "Song" ${GTR} 0.6.1 \\track "Bass" \\tuning (G2 D2 A1 E1) 0.4.1 \\track "Uke" \\tuning (A4 E4 C4 G4) 0.1.1
      \\track "Drums" \\instrument percussion \\articulation defaults "HiHatClosed".4 r.4 r.2 \\track "Lead" \\instrument 73 c5.1 \\track "Silent" ${'\\tuning (E4 B3 G3 D3 A2 E2)'} r.1`)
    const tracks = listTracks(score)
    expect(tracks.map((t) => [t.name, t.kind, t.instrument])).toEqual([
      ['Gtr', 'tab', 'guitar'],
      ['Bass', 'tab', 'bass'],
      ['Uke', 'tab', 'ukulele'],
      ['Drums', 'drums', 'guitar'],
      ['Lead', 'staff', 'guitar'],
      ['Silent', 'empty', 'guitar'],
    ])
    expect(tracks[0].tuning).toEqual([64, 59, 55, 50, 45, 40]) // string 1 (high e) first, like Sheet.tuning
    expect(tracks[1].tuning).toEqual([43, 38, 33, 28])
    expect(() => convertTrack(score, 3, 'x')).toThrow()
    expect(trackTitle(score, 1, 'file.gp5')).toBe('Song - Bass')
  })

  it('numbers strings from the highest, as BePro does', () => {
    const { sheet, content } = tabOf(`${GTR} 3.6.4 0.1.4 (2.2 4.5).2`)
    expect(sheet.type).toBe('tab')
    expect(sheet.tuning).toEqual([64, 59, 55, 50, 45, 40])
    const [a, b, c] = content.measures[0].beats
    expect(a.notes).toEqual([{ string: 6, fret: 3 }]) // low E
    expect(b.notes).toEqual([{ string: 1, fret: 0 }]) // high e
    expect(c.notes.map((n) => n.string).sort()).toEqual([2, 5])
  })

  it('carries title, tempo, key, time signature changes and durations', () => {
    const score = load(`\\title "Tune" \\tempo 84 ${GTR} \\ks (Eminor) 0.1.4{d} 0.1.8 0.1.2 | \\ts (3 4) 0.1.4 {tu 3} 0.1.4 {tu 3} 0.1.4 {tu 3} 0.1.4 | 0.1.2{d}`)
    const sheet = convertTrack(score, 0, trackTitle(score, 0, 'f.gp'))
    const c = sheet.content as TabContent
    expect(sheet.title).toBe('Tune')
    expect(sheet.tempo).toBe(84)
    expect(sheet.key).toBe('Em')
    expect(sheet.timeSignature).toEqual([4, 4])
    expect(c.measures[0].beats[0]).toMatchObject({ duration: 4, dotted: true })
    expect(c.measures[1].timeSignature).toEqual([3, 4])
    expect(c.measures[2].timeSignature).toBeUndefined()
    expect(c.measures[1].beats.slice(0, 3).map((b) => b.tuplet)).toEqual([3, 3, 3])
    c.measures.forEach((m, i) => expect(measureFill(m, tsAt(c, i, sheet.timeSignature))).toBeCloseTo(0))
    expect(keyName(-3, 0)).toBe('Eb')
    expect(keyName(3, 1)).toBe('F#m')
  })

  it('splits lengths the model lacks into tied values and lists unusual tuplets', () => {
    const { sheet, content } = tabOf(`${GTR} 5.1.4{dd} 5.1.16 0.1.2 | 1.1.8{tu (7 4)} 1.1.8{tu (7 4)} 1.1.8{tu (7 4)} 1.1.8{tu (7 4)} 1.1.8{tu (7 4)} 1.1.8{tu (7 4)} 1.1.8{tu (7 4)} 0.1.2`)
    const [a, b] = content.measures[0].beats
    expect(a).toMatchObject({ duration: 4, dotted: true, notes: [{ string: 1, fret: 5 }] })
    expect(b).toMatchObject({ duration: 16, notes: [{ string: 1, fret: 5, tie: true }] })
    expect(measureFill(content.measures[0], [4, 4])).toBe(0)
    expect(sheet.warnings).toContainEqual({ code: 'tuplet', count: 7, detail: '7:4' })
  })

  it('keeps rests, ties, grace notes, chords and lyrics', () => {
    const { content } = tabOf(`${GTR} r.4 3.1.4 {ch "C" lyrics "la"} -.1.4 3.1.16 {gr} 5.1.4`)
    const [rest, chord, tie, grace, after] = content.measures[0].beats
    expect(rest.notes).toEqual([])
    expect(chord).toMatchObject({ chord: 'C', lyric: 'la' })
    expect(tie.notes).toEqual([{ string: 1, fret: 3, tie: true }])
    expect(grace.grace).toBe(true)
    expect(after.grace).toBeUndefined()
  })

  it('converts TAB techniques, including tapping', () => {
    const { content, sheet } = tabOf(
      `${GTR} 5.3{h}.8 7.3.8 7.3{h}.8 5.3.8 3.2{sl}.8 5.2.8 5.3{b (0 4)}.8 5.3{b (0 2 2 0)}.8 | 12.1{nh}.4 5.1{ah}.4 5.1{v}.4 5.1.4{tt} | 0.6{pm}.4 0.6{lr}.4 3.1{g}.4 x.1.4 | 3.1{sib}.4 3.1{sod}.4 3.1{ph}.4 3.1{tr 5 16}.4`,
    )
    const notes = content.measures.map((m) => m.beats.map((b) => b.notes[0]))
    expect(notes[0][0].legato).toBe('h')
    expect(notes[0][2].legato).toBe('p')
    expect(notes[0][4].slide).toBe('to')
    expect(notes[0][6]).toMatchObject({ bend: 1 })
    expect(notes[0][6].release).toBeUndefined()
    expect(notes[0][7]).toMatchObject({ bend: 0.5, release: true })
    expect(notes[1].map((n) => [n.harmonic, n.vibrato, n.tap])).toEqual([['natural', undefined, undefined], ['artificial', undefined, undefined], [undefined, true, undefined], [undefined, undefined, true]])
    expect(notes[2]).toEqual([{ string: 6, fret: 0, palmMute: true }, { string: 6, fret: 0, letRing: true }, { string: 1, fret: 3, ghost: true }, { string: 1, fret: 0, dead: true }])
    expect(notes[3].map((n) => n.slide)).toEqual(['inBelow', 'outDown', undefined, undefined])
    expect(notes[3][2].harmonic).toBeUndefined()
    expect(sheet.warnings.map((w) => w.code).sort()).toEqual(['harmonic', 'trill'])
  })

  it('imports a second voice', () => {
    const { content } = tabOf(`${GTR} \\voice 3.1.2 5.1.2 | 0.1.1 \\voice 0.6.1 | r.1`)
    expect(content.measures[0].voice2).toEqual([expect.objectContaining({ duration: 1, notes: [{ string: 6, fret: 0 }] })])
    expect(content.measures[1].voice2).toBeUndefined()
  })

  it('turns non-stringed tracks into staff sheets with sounding pitch', () => {
    const score = load('\\track "Flute" \\instrument 73 c5.4 d5.4 d5{t}.4 r.4')
    const sheet = convertTrack(score, 0, 'Flute')
    expect(sheet.type).toBe('staff')
    const c = sheet.content as MelodyContent
    expect(c.kind).toBe('melody')
    expect(c.measures[0].beats.map((b) => b.notes)).toEqual([[{ midi: 72 }], [{ midi: 74 }], [{ midi: 74, tie: true }], []])
  })

  it('lists the capo and keeps frets as written', () => {
    const { sheet, content } = tabOf(`${GTR} \\capo 2 2.1.1`)
    expect(content.measures[0].beats[0].notes[0].fret).toBe(2)
    expect(sheet.warnings).toContainEqual({ code: 'capo', count: 1, detail: '2' })
  })

  it('reads Guitar Pro and MusicXML bytes', () => {
    const settings = new at.Settings()
    const gp = new at.exporter.Gp7Exporter().export(load(`\\title "GP" ${GTR} r.1 \\track "Bass" \\tuning (G2 D2 A1 E1) 3.4.1 | 3.1.2 5.4.2{tt}`), settings)
    const fromGp = at.importer.ScoreLoader.loadScoreFromBytes(gp, settings)
    expect(listTracks(fromGp).map((t) => t.kind)).toEqual(['empty', 'tab'])
    const c = convertTrack(fromGp, 1, 'GP').content as TabContent
    expect(c.measures[0].beats[0].notes).toEqual([{ string: 4, fret: 3 }])
    expect(c.measures[1].beats.map((b) => b.notes)).toEqual([[{ string: 1, fret: 3 }], [{ string: 4, fret: 5, tap: true }]])

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><work><work-title>XML</work-title></work>
<part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>-1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><type>half</type><lyric><text>Hi</text></lyric></note>
<note><rest/><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>`
    const fromXml = at.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), settings)
    const sheet = convertTrack(fromXml, 0, trackTitle(fromXml, 0, 'x.xml'))
    expect(sheet).toMatchObject({ type: 'staff', title: 'XML', key: 'F', timeSignature: [3, 4] })
    expect((sheet.content as MelodyContent).measures[0].beats[0]).toMatchObject({ duration: 2, lyric: 'Hi', notes: [{ midi: 69 }] })
  })
})
