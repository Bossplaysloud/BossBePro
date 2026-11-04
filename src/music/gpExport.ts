// Guitar Pro export: a sheet's notes go through the same alphaTex the score view draws, into an
// alphaTab score, written as a Guitar Pro 7/8 (.gp) file. Only sheets made of notes can go:
// TAB, staff, and numbered notation (saved as staff notation).

import type { Sheet } from '../db/db'
import { melodyToAlphaTex, tabToAlphaTex, type MelodyTexOptions } from './alphatex'
import { sheetProgram } from './instruments'
import { isMelodyContent } from './melody'
import { isTabContent } from './tab'

/** The clef staff and numbered sheets are written with, by instrument. */
export const SHEET_CLEF: Record<Sheet['instrument'], MelodyTexOptions['clef']> = { guitar: 'treble8', custom: 'treble8', bass: 'bass', ukulele: 'treble' }

type GpSource = Pick<Sheet, 'type' | 'content' | 'title' | 'tempo' | 'tuning' | 'timeSignature' | 'key' | 'instrument' | 'program'>

/** The sheet as alphaTex, or null when it holds no notes (chord chart, pictures). */
export function sheetAlphaTex(sheet: GpSource): string | null {
  const c = sheet.content
  if (sheet.type === 'tab' && isTabContent(c)) return tabToAlphaTex(c, { title: sheet.title, tempo: sheet.tempo, tuning: sheet.tuning, timeSignature: sheet.timeSignature, program: sheetProgram(sheet) })
  if ((sheet.type === 'staff' || sheet.type === 'numbered') && isMelodyContent(c)) return melodyToAlphaTex(c, { title: sheet.title, tempo: sheet.tempo, timeSignature: sheet.timeSignature, key: sheet.key, clef: SHEET_CLEF[sheet.instrument], program: sheetProgram(sheet) })
  return null
}

export const canExportGp = (sheet: GpSource) => sheetAlphaTex(sheet) !== null

/** The sheet as the bytes of a .gp file, or null when it holds no notes. */
export async function sheetToGp(sheet: GpSource): Promise<Uint8Array | null> {
  const tex = sheetAlphaTex(sheet)
  if (tex === null) return null
  const at = await import('@coderline/alphatab')
  const settings = new at.Settings()
  return new at.exporter.Gp7Exporter().export(at.importer.ScoreLoader.loadAlphaTex(tex, settings), settings)
}

/** A safe file name for the sheet: its title without characters file systems refuse. */
export const gpFileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'BossBePro'}.gp`
