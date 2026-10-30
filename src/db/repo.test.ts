import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db } from './db'
import { addImagePages, createImageSheet, moveImagePage, removeImagePage, switchSheetType, addToSongbook, createSection, createSheet, createSongbook, deleteSection, deleteSheet, deleteSongbook, removeSongbookEntry, reorder, reorderSongbook, updateImageNotes } from './repo'
import { imageNotes, notesMatch } from '../music/imageSheet'

describe('repo', () => {
  it('deleting a section moves its sheets to unsorted', async () => {
    const sec = await createSection('Riffs')
    const id = await createSheet({ title: 'x', type: 'tab', sectionId: sec, instrument: 'bass', strings: 5 })
    expect((await db.sheets.get(id))?.tuning).toHaveLength(5)
    await deleteSection(sec)
    expect((await db.sheets.get(id))?.sectionId).toBeNull()
    expect(await db.sections.get(sec)).toBeUndefined()
  })

  it('deleting a section with its sheets deletes them and takes them out of songbooks', async () => {
    const sec = await createSection('Old')
    const id = await createSheet({ title: 'gone', type: 'chord', sectionId: sec, instrument: 'guitar', strings: 6 })
    const keep = await createSheet({ title: 'kept', type: 'chord', sectionId: null, instrument: 'guitar', strings: 6 })
    const book = await createSongbook('Set')
    await addToSongbook(book, [id, keep])
    await deleteSection(sec, true)
    expect(await db.sheets.get(id)).toBeUndefined()
    expect(await db.sheets.get(keep)).toBeDefined()
    expect((await db.songbooks.get(book))?.entries.map((e) => e.sheetId)).toEqual([keep])
    expect(await db.sections.get(sec)).toBeUndefined()
  })

  it('reordering a subset keeps other items in place', async () => {
    await db.sheets.clear()
    const mk = (title: string) => createSheet({ title, type: 'tab', sectionId: null, instrument: 'guitar', strings: 6 })
    const [, b, , d] = [await mk('a'), await mk('b'), await mk('c'), await mk('d')]
    await reorder('sheets', [d, b]) // only b and d visible (filtered), swap them
    const titles = (await db.sheets.orderBy('order').toArray()).map((s) => s.title)
    expect(titles).toEqual(['a', 'd', 'c', 'b'])
  })

  it('songbooks hold the same sheet more than once, keep their order, and lose deleted sheets', async () => {
    const mk = (title: string) => createSheet({ title, type: 'chord', sectionId: null, instrument: 'guitar', strings: 6 })
    const [a, b] = [await mk('A'), await mk('B')]
    const book = await createSongbook('Live set')
    const other = await createSongbook('Practice')
    await addToSongbook(book, [a, b, a])
    await addToSongbook(other, [a])
    let entries = (await db.songbooks.get(book))!.entries
    expect(entries.map((e) => e.sheetId)).toEqual([a, b, a])
    await reorderSongbook(book, [entries[2].id, entries[0].id, entries[1].id])
    entries = (await db.songbooks.get(book))!.entries
    expect(entries.map((e) => e.sheetId)).toEqual([a, a, b])
    await removeSongbookEntry(book, entries[0].id)
    expect((await db.songbooks.get(book))!.entries.map((e) => e.sheetId)).toEqual([a, b])
    await deleteSheet(a)
    expect((await db.songbooks.get(book))!.entries.map((e) => e.sheetId)).toEqual([b])
    expect((await db.songbooks.get(other))!.entries).toEqual([])
    await deleteSongbook(book)
    expect(await db.sheets.get(b)).toBeTruthy() // the sheets stay
  })

  it('picture / PDF sheets keep their files, can add, reorder and remove them, and delete them with the sheet', async () => {
    const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type })
    const id = await createImageSheet({ title: 'Scan', sectionId: null, files: [file('p1.png', 'image/png'), file('song.pdf', 'application/pdf')] })
    let sheet = (await db.sheets.get(id))!
    expect(sheet.type).toBe('image')
    const pages = () => (sheet.content as { pages: { assetId: string; mime: string; name: string }[] }).pages
    expect(pages().map((p) => [p.name, p.mime])).toEqual([['p1.png', 'image/png'], ['song.pdf', 'application/pdf']])
    expect((await db.assets.get(pages()[1].assetId))?.kind).toBe('pdf')
    await addImagePages(id, [file('p2.jpg', 'image/jpeg')])
    sheet = (await db.sheets.get(id))!
    await moveImagePage(id, pages()[2].assetId, -1)
    sheet = (await db.sheets.get(id))!
    expect(pages().map((p) => p.name)).toEqual(['p1.png', 'p2.jpg', 'song.pdf'])
    const removed = pages()[0].assetId
    await removeImagePage(id, removed)
    sheet = (await db.sheets.get(id))!
    expect(pages().map((p) => p.name)).toEqual(['p2.jpg', 'song.pdf'])
    expect(await db.assets.get(removed)).toBeUndefined()
    expect(await switchSheetType(id, 'tab')).toBe('same') // turned into notation only through recognition
    const left = pages().map((p) => p.assetId)
    await deleteSheet(id)
    expect(await db.assets.bulkGet(left)).toEqual([undefined, undefined])
  })

  it('picture sheets keep notes and stickies; removing a file takes its stickies along', async () => {
    const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' })
    const id = await createImageSheet({ title: 'Noted', sectionId: null, files: [file('a.png'), file('b.png')] })
    const [a, b] = ((await db.sheets.get(id))!.content as { pages: { assetId: string }[] }).pages.map((p) => p.assetId)
    const sticky = (sid: string, assetId: string, text: string) => ({ id: sid, assetId, page: 0, x: 0.1, y: 0.2, text, color: 'yellow' as const, size: 'm' as const })
    await updateImageNotes(id, (n) => ({ ...n, text: 'Slow down in bar 9', stickies: [sticky('s1', a, 'palm mute'), sticky('s2', b, 'Capo 2')] }))
    await addImagePages(id, [file('c.png')]) // other changes keep the notes
    let notes = imageNotes((await db.sheets.get(id))!.content)
    expect(notes.text).toBe('Slow down in bar 9')
    expect(notes.stickies).toHaveLength(2)
    await removeImagePage(id, a)
    const content = (await db.sheets.get(id))!.content
    notes = imageNotes(content)
    expect(notes.stickies.map((s) => s.id)).toEqual(['s2'])
    expect(notesMatch(content, 'capo', true)).toBe(true)
    expect(notesMatch(content, 'capo', false)).toBe(false)
    await updateImageNotes(id, (n) => ({ ...n, searchable: true }))
    expect(notesMatch((await db.sheets.get(id))!.content, 'bar 9', false)).toBe(true)
  })
})
