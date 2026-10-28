import Dexie, { type EntityTable } from 'dexie'
import type { InstrumentId } from '../music/instruments'

/** 'image': the sheet is just pictures or a PDF, for reading only (no editing or recognition). */
export type SheetType = 'tab' | 'staff' | 'chord' | 'numbered' | 'image'
/** Notation types: the ones that can be edited and switched between. */
export const SHEET_TYPES: Exclude<SheetType, 'image'>[] = ['tab', 'staff', 'chord', 'numbered']

export interface Section {
  id: string
  name: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface Sheet {
  id: string
  sectionId: string | null // null = unsorted
  title: string
  type: SheetType
  instrument: InstrumentId
  tuning: number[] // MIDI, string 1 (highest) first
  frets?: number // instrument fret count (12–36); older sheets fall back to the instrument default
  program?: number // General MIDI sound for playback; defaults by instrument
  timeSignature: [number, number]
  key: string // e.g. "C", "G", "Am"; used by numbered notation
  tempo: number
  tags: string[]
  content: unknown // TabContent | MelodyContent | ChordChartContent, by type
  /** Content of other notation kinds kept when the type was switched, so switching back restores it. */
  archive?: Partial<Record<'tab' | 'melody' | 'chords', unknown>>
  sourceImageId: string | null // original image when created by recognition (the first one)
  sourceImageIds?: string[] // all original images, in order, when several were recognized together
  order: number
  createdAt: number
  updatedAt: number
}

/**
 * A songbook (歌本): an ordered list of sheets, like a set list. Unlike sections, a sheet can be in
 * any number of songbooks, and more than once in the same one; entries only point at sheets.
 */
export interface Songbook {
  id: string
  name: string
  order: number
  entries: SongbookEntry[]
  createdAt: number
  updatedAt: number
}

export interface SongbookEntry {
  id: string // its own id, so the same sheet can appear twice
  sheetId: string
}

export interface CustomTuning {
  id: string
  name: string
  notes: number[]
  createdAt: number
  updatedAt: number
}

/** Binary assets: source images, picture / PDF sheets, imported SoundFonts. */
export interface Asset {
  id: string
  kind: 'image' | 'soundfont' | 'pdf'
  name: string
  mime: string
  blob: Blob
  createdAt: number
  updatedAt: number
}

/** Small key/value store for data-related metadata (backup timestamps etc). */
export interface Meta {
  key: string
  value: unknown
}

export class BeProDB extends Dexie {
  sections!: EntityTable<Section, 'id'>
  sheets!: EntityTable<Sheet, 'id'>
  tunings!: EntityTable<CustomTuning, 'id'>
  assets!: EntityTable<Asset, 'id'>
  meta!: EntityTable<Meta, 'key'>
  songbooks!: EntityTable<Songbook, 'id'>

  constructor(name = 'bepro') {
    super(name)
    this.version(1).stores({
      sections: 'id, order',
      sheets: 'id, sectionId, type, order, updatedAt, *tags',
      tunings: 'id',
      assets: 'id, kind',
      meta: 'key',
    })
    // v2: songbooks. Existing tables are unchanged.
    this.version(2).stores({ songbooks: 'id, order' })

    // Track the last user change so the backup reminder knows whether there is anything new.
    // Meta writes are excluded, otherwise recording a backup would itself count as a change.
    // Deferred so it runs outside the triggering transaction (which may not include `meta`).
    const touch = () => {
      setTimeout(() => void this.meta.put({ key: 'lastChangeAt', value: Date.now() }), 0)
    }
    for (const table of [this.sections, this.sheets, this.tunings, this.assets, this.songbooks] as Dexie.Table[]) {
      table.hook('creating', touch)
      table.hook('updating', touch)
      table.hook('deleting', touch)
    }
  }
}

export const db = new BeProDB()

export const DATA_TABLES = ['sections', 'sheets', 'tunings', 'assets', 'songbooks'] as const
export type DataTable = (typeof DATA_TABLES)[number]

export const newId = () => crypto.randomUUID()

export async function getMeta<T>(key: string, database: BeProDB = db): Promise<T | undefined> {
  return (await database.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown, database: BeProDB = db) {
  await database.meta.put({ key, value })
}

/** Ask the browser not to evict our data (matters on iOS Safari). */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    /* not supported */
  }
}
