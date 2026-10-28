import { db, newId, type Section, type Sheet, type SheetType, type Songbook } from './db'
import { DEFAULT_FRETS, defaultTuning, sheetFrets, type InstrumentId } from '../music/instruments'
import { contentKind, convertContent, kindOf } from '../music/convert'
import { flushPendingSaves } from '../lib/pendingSaves'
import { isImageSheetContent, isPdf, type ImageSheetContent, type ImageSheetPage } from '../music/imageSheet'

export async function createSection(name: string): Promise<string> {
  const last = await db.sections.orderBy('order').last()
  const now = Date.now()
  const id = newId()
  await db.sections.add({ id, name, order: (last?.order ?? 0) + 1, createdAt: now, updatedAt: now })
  return id
}

export async function renameSection(id: string, name: string) {
  await db.sections.update(id, { name, updatedAt: Date.now() })
}

/** Deleting a section keeps its sheets: they move to "Unsorted". */
export async function deleteSection(id: string) {
  await db.transaction('rw', db.sections, db.sheets, async () => {
    const now = Date.now()
    await db.sheets.where('sectionId').equals(id).modify({ sectionId: null, updatedAt: now })
    await db.sections.delete(id)
  })
}

/**
 * Reorders the given items among themselves. `orderedIds` may be a filtered subset
 * (e.g. one section's sheets): the subset reuses its existing order slots, so items
 * outside it keep their positions.
 */
export async function reorder(table: 'sections' | 'sheets' | 'songbooks', orderedIds: string[]) {
  const t = (table === 'sections' ? db.sections : table === 'songbooks' ? db.songbooks : db.sheets) as unknown as typeof db.sections
  await db.transaction('rw', t, async () => {
    const rows = await t.bulkGet(orderedIds)
    const slots = rows.map((r) => r?.order ?? 0).sort((a, b) => a - b)
    for (const [i, id] of orderedIds.entries()) await t.update(id, { order: slots[i] })
  })
}

export interface NewSheetInput {
  title: string
  type: SheetType
  sectionId: string | null
  instrument: InstrumentId
  strings: number
  tuning?: number[]
}

export async function createSheet(input: NewSheetInput): Promise<string> {
  const now = Date.now()
  const id = newId()
  const last = await db.sheets.orderBy('order').last()
  const sheet: Sheet = {
    id,
    sectionId: input.sectionId,
    title: input.title,
    type: input.type,
    instrument: input.instrument,
    tuning: input.tuning ?? defaultTuning(input.instrument, input.strings),
    frets: DEFAULT_FRETS[input.instrument],
    timeSignature: [4, 4],
    key: 'C',
    tempo: 100,
    tags: [],
    content: null,
    sourceImageId: null,
    order: (last?.order ?? 0) + 1,
    createdAt: now,
    updatedAt: now,
  }
  await db.sheets.add(sheet)
  return id
}

export async function updateSheet(id: string, changes: Partial<Omit<Sheet, 'id' | 'createdAt'>>) {
  await db.sheets.update(id, { ...changes, updatedAt: Date.now() })
}

/** Deleting a sheet also takes it out of every songbook (and a picture / PDF sheet takes its files along). */
export async function deleteSheet(id: string) {
  await db.transaction('rw', db.sheets, db.songbooks, db.assets, async () => {
    const sheet = await db.sheets.get(id)
    if (sheet?.type === 'image' && isImageSheetContent(sheet.content)) await db.assets.bulkDelete(sheet.content.pages.map((p) => p.assetId))
    await db.sheets.delete(id)
    const now = Date.now()
    for (const book of await db.songbooks.toArray()) {
      if (book.entries.some((e) => e.sheetId === id)) await db.songbooks.update(book.id, { entries: book.entries.filter((e) => e.sheetId !== id), updatedAt: now })
    }
  })
}

// ---------- picture / PDF sheets ----------

async function storeFiles(files: File[]): Promise<ImageSheetPage[]> {
  const now = Date.now()
  const pages: ImageSheetPage[] = []
  for (const f of files) {
    const id = newId()
    const pdf = isPdf(f)
    await db.assets.add({ id, kind: pdf ? 'pdf' : 'image', name: f.name, mime: pdf ? 'application/pdf' : f.type || 'image/png', blob: f, createdAt: now, updatedAt: now })
    pages.push({ assetId: id, mime: pdf ? 'application/pdf' : f.type || 'image/png', name: f.name })
  }
  return pages
}

/** A sheet that is only pictures and/or PDFs, for reading. */
export async function createImageSheet(input: { title: string; sectionId: string | null; files: File[] }): Promise<string> {
  const id = await createSheet({ title: input.title, type: 'image', sectionId: input.sectionId, instrument: 'guitar', strings: 6 })
  const content: ImageSheetContent = { kind: 'images', version: 1, pages: await storeFiles(input.files) }
  await db.sheets.update(id, { content })
  return id
}

export async function addImagePages(id: string, files: File[]) {
  const sheet = await db.sheets.get(id)
  if (!sheet || !isImageSheetContent(sheet.content)) return
  const pages = await storeFiles(files)
  await updateSheet(id, { content: { ...sheet.content, pages: [...sheet.content.pages, ...pages] } })
}

export async function removeImagePage(id: string, assetId: string) {
  await db.transaction('rw', db.sheets, db.assets, async () => {
    const sheet = await db.sheets.get(id)
    if (!sheet || !isImageSheetContent(sheet.content)) return
    await db.assets.delete(assetId)
    await db.sheets.update(id, { content: { ...sheet.content, pages: sheet.content.pages.filter((p) => p.assetId !== assetId) }, updatedAt: Date.now() })
  })
}

export async function moveImagePage(id: string, assetId: string, dir: -1 | 1) {
  const sheet = await db.sheets.get(id)
  if (!sheet || !isImageSheetContent(sheet.content)) return
  const pages = [...sheet.content.pages]
  const i = pages.findIndex((p) => p.assetId === assetId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= pages.length) return
  ;[pages[i], pages[j]] = [pages[j], pages[i]]
  await updateSheet(id, { content: { ...sheet.content, pages } })
}

// ---------- songbooks ----------

export async function createSongbook(name: string): Promise<string> {
  const last = await db.songbooks.orderBy('order').last()
  const now = Date.now()
  const id = newId()
  await db.songbooks.add({ id, name, order: (last?.order ?? 0) + 1, entries: [], createdAt: now, updatedAt: now })
  return id
}

export async function renameSongbook(id: string, name: string) {
  await db.songbooks.update(id, { name, updatedAt: Date.now() })
}

/** Deleting a songbook never deletes its sheets. */
export async function deleteSongbook(id: string) {
  await db.songbooks.delete(id)
}

/** Adds sheets at the end, in the given order; a sheet already in the book is added again. */
export async function addToSongbook(id: string, sheetIds: string[]) {
  await db.transaction('rw', db.songbooks, async () => {
    const book = await db.songbooks.get(id)
    if (!book) return
    await db.songbooks.update(id, { entries: [...book.entries, ...sheetIds.map((sheetId) => ({ id: newId(), sheetId }))], updatedAt: Date.now() })
  })
}

export async function removeSongbookEntry(id: string, entryId: string) {
  await db.transaction('rw', db.songbooks, async () => {
    const book = await db.songbooks.get(id)
    if (book) await db.songbooks.update(id, { entries: book.entries.filter((e) => e.id !== entryId), updatedAt: Date.now() })
  })
}

/** Puts the entries in the given order (ids not listed keep their place at the end). */
export async function reorderSongbook(id: string, entryIds: string[]) {
  await db.transaction('rw', db.songbooks, async () => {
    const book = await db.songbooks.get(id)
    if (!book) return
    const byId = new Map(book.entries.map((e) => [e.id, e]))
    const ordered = entryIds.flatMap((e) => (byId.has(e) ? [byId.get(e)!] : []))
    const rest = book.entries.filter((e) => !entryIds.includes(e.id))
    await db.songbooks.update(id, { entries: [...ordered, ...rest], updatedAt: Date.now() })
  })
}

export type { Section, Sheet, Songbook }

export type SwitchResult = 'same' | 'restored' | 'converted' | 'empty'

/**
 * Changes a sheet's notation type. The current content is archived under its kind; the new
 * content is the archived one for that kind if any, else a conversion, else empty.
 */
export async function switchSheetType(id: string, type: SheetType): Promise<SwitchResult> {
  await flushPendingSaves()
  const sheet = await db.sheets.get(id)
  if (!sheet || sheet.type === type) return 'same'
  // Picture / PDF sheets have no notation to switch: they are turned into notation by recognition.
  if (sheet.type === 'image' || type === 'image') return 'same'
  const from = contentKind(sheet.content)
  const to = kindOf(type)
  if (from === to || from === null) {
    await updateSheet(id, { type })
    return 'same'
  }
  const archive = { ...(sheet.archive ?? {}), [from]: sheet.content }
  let content = archive[to]
  let result: SwitchResult = 'restored'
  delete archive[to]
  if (content === undefined) {
    content = convertContent(sheet.content, to, sheet.tuning, sheetFrets(sheet))
    result = content ? 'converted' : 'empty'
  }
  await updateSheet(id, { type, content: content ?? null, archive })
  return result
}
