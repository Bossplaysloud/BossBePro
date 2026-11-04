import { describe, expect, it } from 'vitest'
import * as at from '@coderline/alphatab'
import { convertTrack, type GpSheet } from './gpImport'
import { canExportGp, gpFileName, sheetToGp } from './gpExport'

// Ids are made fresh on every import; everything else must come back the same.
const noIds = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'id' ? undefined : v)))
const GTR = '\\track "Gtr" \\tuning (E4 B3 G3 D3 A2 E2)'
const imported = (tex: string) => convertTrack(at.importer.ScoreLoader.loadAlphaTex(tex), 0, 'Song')
const asSheet = (g: GpSheet, type: 'tab' | 'staff' | 'numbered' = g.type) => ({ ...g, type, title: 'Song', instrument: g.instrument, program: undefined })
// Write the sheet as .gp, then read it back the way "Import GP" does.
const roundTrip = async (sheet: ReturnType<typeof asSheet>) => {
  const bytes = await sheetToGp(sheet)
  expect(bytes).not.toBeNull()
  return convertTrack(at.importer.ScoreLoader.loadScoreFromBytes(bytes!, new at.Settings()), 0, 'Song')
}

describe('GP export', () => {
  it('writes a TAB sheet that reads back with the same notes, techniques, tuning and tempo', async () => {
    const tab = imported(`\\tempo 96 ${GTR} \\ts (3 4) 3.3.4 5.3{b (0 4)}.8 7.2.8 | 5.3{h}.8 7.3.8 3.2{sl}.8 5.2.8 12.1{nh}.4 | 5.1{v}.4 0.6{pm}.4 5.1.4{tt}`)
    const back = await roundTrip(asSheet(tab))
    expect(back.type).toBe('tab')
    expect(back.tuning).toEqual(tab.tuning)
    expect(back.tempo).toBe(96)
    expect(back.timeSignature).toEqual([3, 4])
    expect(noIds(back.content)).toEqual(noIds(tab.content))
  })

  it('writes staff and numbered sheets as staff notation', async () => {
    const staff = imported('\\track "Lead" \\instrument 73 \\ks (G) c5.4 d5.8 e5.8 f#5.2 | g5.1')
    expect(staff.type).toBe('staff')
    for (const type of ['staff', 'numbered'] as const) {
      const back = await roundTrip(asSheet(staff, type))
      expect(back.type).toBe('staff')
      expect(noIds(back.content)).toEqual(noIds(staff.content))
    }
  })

  it('leaves out sheets without notes, and makes safe file names', async () => {
    const chord = { type: 'chord' as const, content: { kind: 'chords' }, title: 'C', tempo: 90, tuning: [64, 59, 55, 50, 45, 40], timeSignature: [4, 4] as [number, number], key: 'C', instrument: 'guitar' as const }
    expect(canExportGp(chord)).toBe(false)
    expect(await sheetToGp({ ...chord, type: 'image' })).toBeNull()
    expect(gpFileName('Autumn Leaves / Solo?')).toBe('Autumn Leaves Solo.gp')
    expect(gpFileName('  ')).toBe('BePro.gp')
  })
})
