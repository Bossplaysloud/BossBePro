import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { BackupError, createBackup, parseBackup, restoreBackup } from './backup'
import { BeProDB, type Sheet } from './db'

let n = 0
const freshDb = () => new BeProDB(`test-${n++}`)

const sheet = (id: string, title: string, updatedAt: number): Sheet => ({
  id, sectionId: null, title, type: 'tab', instrument: 'guitar', tuning: [64, 59, 55, 50, 45, 40],
  timeSignature: [4, 4], key: 'C', tempo: 100, tags: [], content: null, sourceImageId: null,
  order: 1, createdAt: 0, updatedAt,
})

describe('backup', () => {
  let src: BeProDB
  beforeEach(async () => {
    src = freshDb()
    await src.sections.add({ id: 's1', name: 'Solos', order: 1, createdAt: 0, updatedAt: 0 })
    await src.sheets.bulkAdd([sheet('a', 'A', 10), sheet('b', 'B', 10)])
    await src.assets.add({ id: 'img', kind: 'image', name: 'x.png', mime: 'image/png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), createdAt: 0, updatedAt: 0 })
  })

  it('round-trips through JSON including blobs', async () => {
    const json = JSON.stringify(await createBackup(src))
    const dst = freshDb()
    const r = await restoreBackup(parseBackup(json), 'replace', dst)
    expect(r.added).toBe(4)
    expect((await dst.sheets.get('a'))?.title).toBe('A')
    const blob = (await dst.assets.get('img'))!.blob
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3])
    expect(blob.type).toBe('image/png')
  })

  it('merge keeps newer local edits and adds missing records', async () => {
    const backup = parseBackup(JSON.stringify(await createBackup(src)))
    const dst = freshDb()
    await dst.sheets.bulkAdd([sheet('a', 'A local newer', 20), sheet('b', 'B local older', 5), sheet('c', 'C only local', 1)])
    const r = await restoreBackup(backup, 'merge', dst)
    expect((await dst.sheets.get('a'))?.title).toBe('A local newer')
    expect((await dst.sheets.get('b'))?.title).toBe('B')
    expect(await dst.sheets.get('c')).toBeTruthy()
    expect(r).toEqual({ added: 2, updated: 1, skipped: 1 })
  })

  it('replace wipes data not in the backup', async () => {
    const backup = parseBackup(JSON.stringify(await createBackup(src)))
    const dst = freshDb()
    await dst.sheets.add(sheet('c', 'C', 1))
    await restoreBackup(backup, 'replace', dst)
    expect(await dst.sheets.get('c')).toBeUndefined()
    expect(await dst.sheets.count()).toBe(2)
  })

  it('includes songbooks, and still reads backups made before songbooks existed', async () => {
    await src.songbooks.add({ id: 'bk', name: 'Live', order: 1, entries: [{ id: 'e1', sheetId: 'a' }, { id: 'e2', sheetId: 'a' }], createdAt: 0, updatedAt: 0 })
    const backup = await createBackup(src)
    const dst = freshDb()
    await restoreBackup(parseBackup(JSON.stringify(backup)), 'replace', dst)
    expect((await dst.songbooks.get('bk'))?.entries.map((e) => e.sheetId)).toEqual(['a', 'a'])
    const { songbooks: _drop, ...olderData } = backup.data
    void _drop
    const old = { ...backup, data: olderData }
    const merged = freshDb()
    await restoreBackup(parseBackup(JSON.stringify(old)), 'merge', merged)
    expect(await merged.sheets.count()).toBe(2)
    expect(await merged.songbooks.count()).toBe(0)
  })

  it('rejects invalid and newer-format files', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError)
    expect(() => parseBackup(JSON.stringify({ app: 'Other', format: 1, data: {} }))).toThrow(BackupError)
    try {
      parseBackup(JSON.stringify({ app: 'BePro', format: 99, exportedAt: 0, data: {} }))
    } catch (e) {
      expect((e as BackupError).code).toBe('newerFormat')
    }
  })
})
