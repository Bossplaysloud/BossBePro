import { db as defaultDb, DATA_TABLES, setMeta, type BeProDB, type DataTable } from './db'

export const BACKUP_FORMAT = 1

interface SerializedBlob {
  __blob: true
  type: string
  base64: string
}

export interface BackupFile {
  app: 'BePro'
  format: number
  exportedAt: number
  data: Record<DataTable, Record<string, unknown>[]>
}

export type RestoreMode = 'merge' | 'replace'

export interface RestoreResult {
  added: number
  updated: number
  skipped: number
}

export class BackupError extends Error {
  code: 'invalid' | 'newerFormat'
  constructor(code: 'invalid' | 'newerFormat') {
    super(code)
    this.code = code
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

async function serialize(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Blob ? ({ __blob: true, type: v.type, base64: await blobToBase64(v) } satisfies SerializedBlob) : v
  }
  return out
}

function deserialize(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    const b = v as SerializedBlob
    out[k] = b && typeof b === 'object' && b.__blob ? base64ToBlob(b.base64, b.type) : v
  }
  return out
}

export async function createBackup(database: BeProDB = defaultDb): Promise<BackupFile> {
  const data = {} as BackupFile['data']
  for (const name of DATA_TABLES) {
    const rows = (await database.table(name).toArray()) as Record<string, unknown>[]
    data[name] = await Promise.all(rows.map(serialize))
  }
  return { app: 'BePro', format: BACKUP_FORMAT, exportedAt: Date.now(), data }
}

export function parseBackup(text: string): BackupFile {
  let parsed: BackupFile
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupError('invalid')
  }
  if (!parsed || parsed.app !== 'BePro' || typeof parsed.format !== 'number' || typeof parsed.data !== 'object') {
    throw new BackupError('invalid')
  }
  if (parsed.format > BACKUP_FORMAT) throw new BackupError('newerFormat')
  for (const name of DATA_TABLES) {
    const rows = parsed.data[name] ?? []
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.id !== 'string')) throw new BackupError('invalid')
    parsed.data[name] = rows
  }
  return parsed
}

/**
 * merge: keep existing data, add records from the backup; when the same record exists on
 *        both sides the more recently updated one wins.
 * replace: wipe all data and load the backup exactly.
 */
export async function restoreBackup(
  backup: BackupFile,
  mode: RestoreMode,
  database: BeProDB = defaultDb,
): Promise<RestoreResult> {
  const result: RestoreResult = { added: 0, updated: 0, skipped: 0 }
  const tables = DATA_TABLES.map((n) => database.table(n))
  await database.transaction('rw', tables, async () => {
    for (const name of DATA_TABLES) {
      const table = database.table(name)
      const rows = backup.data[name].map(deserialize)
      if (mode === 'replace') {
        await table.clear()
        await table.bulkPut(rows)
        result.added += rows.length
        continue
      }
      for (const row of rows) {
        const existing = (await table.get(row.id as string)) as { updatedAt?: number } | undefined
        if (!existing) {
          await table.put(row)
          result.added++
        } else if (((row.updatedAt as number) ?? 0) > (existing.updatedAt ?? 0)) {
          await table.put(row)
          result.updated++
        } else {
          result.skipped++
        }
      }
    }
  })
  return result
}

export function backupFileName(date = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `BePro-backup-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`
}

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * Saves the backup to the user's device. On iOS the share sheet is the reliable way
 * to put a file into Files / iCloud Drive, so prefer it there.
 * Returns false if the user cancelled.
 */
export async function exportBackupToFile(database: BeProDB = defaultDb): Promise<boolean> {
  const backup = await createBackup(database)
  const name = backupFileName()
  const file = new File([JSON.stringify(backup)], name, { type: 'application/json' })

  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false
      throw e
    }
  } else {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  await setMeta('lastBackupAt', Date.now(), database)
  return true
}
