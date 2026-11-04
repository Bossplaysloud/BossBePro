import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { addToSongbook, createSection, createSongbook, moveSheets } from '../db/repo'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { useToast } from './Toast'

/** One destination row: icon, name, count, and a button that sends the selected sheets there. */
function Pick({ icon, name, meta, label, onPick, busy }: { icon: 'folder' | 'inbox' | 'book'; name: string; meta: string; label: string; onPick: () => void; busy: boolean }) {
  return (
    <div className="songbook-pick">
      <Icon name={icon} />
      <div className="body">
        <div className="title">{name}</div>
        <div className="meta">{meta}</div>
      </div>
      <button className="btn" disabled={busy} onClick={onPick}>{label}</button>
    </div>
  )
}

/** A name field with a button that creates the destination and sends the sheets there at once. */
function CreateRow({ placeholder, label, onCreate, busy }: { placeholder: string; label: string; onCreate: (name: string) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState('')
  const create = async () => {
    const n = name.trim()
    if (!n || busy) return
    await onCreate(n)
    setName('')
  }
  return (
    <div className="row">
      <input className="input" style={{ flex: 1 }} placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void create()} />
      <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void create()}>
        <Icon name="plus" />
        {label}
      </button>
    </div>
  )
}

/** Moves the selected sheets to a section, unsorted, or a new section. */
export function MoveToSectionDialog({ open, sheetIds, onClose, onDone }: { open: boolean; sheetIds: string[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const sections = useLiveQuery(() => db.sections.orderBy('order').toArray(), []) ?? []
  const counts = useLiveQuery(async () => {
    const m = new Map<string | null, number>()
    for (const s of await db.sheets.toArray()) m.set(s.sectionId, (m.get(s.sectionId) ?? 0) + 1)
    return m
  }, []) ?? new Map<string | null, number>()
  const [busy, setBusy] = useState(false)

  const move = async (sectionId: string | null, name: string) => {
    setBusy(true)
    try {
      await moveSheets(sheetIds, sectionId)
      toast(t('bulk.moved', { count: sheetIds.length, name }))
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} locked={busy} onClose={onClose} title={t('bulk.moveTitle', { count: sheetIds.length })} actions={<button className="btn" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>}>
      <div className="songbook-picker">
        <Pick icon="inbox" name={t('nav.unsorted')} meta={t('dash.sheets', { count: counts.get(null) ?? 0 })} label={t('bulk.choose')} busy={busy} onPick={() => void move(null, t('nav.unsorted'))} />
        {sections.map((s) => (
          <Pick key={s.id} icon="folder" name={s.name} meta={t('dash.sheets', { count: counts.get(s.id) ?? 0 })} label={t('bulk.choose')} busy={busy} onPick={() => void move(s.id, s.name)} />
        ))}
      </div>
      <CreateRow placeholder={t('section.namePlaceholder')} label={t('bulk.createSection')} busy={busy} onCreate={async (name) => move(await createSection(name), name)} />
    </Modal>
  )
}

/** Adds the selected sheets to the end of a songbook, or of a new songbook; their sections stay as they are. */
export function AddManyToSongbookDialog({ open, sheetIds, onClose, onDone }: { open: boolean; sheetIds: string[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const books = useLiveQuery(() => db.songbooks.orderBy('order').toArray(), []) ?? []
  const [busy, setBusy] = useState(false)

  const add = async (bookId: string, name: string) => {
    setBusy(true)
    try {
      await addToSongbook(bookId, sheetIds)
      toast(t('bulk.added', { count: sheetIds.length, name }))
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} locked={busy} onClose={onClose} title={t('bulk.songbookTitle', { count: sheetIds.length })} actions={<button className="btn" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>}>
      {books.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('songbook.none')}</p>}
      <div className="songbook-picker">
        {books.map((b) => (
          <Pick key={b.id} icon="book" name={b.name} meta={t('songbook.songs', { count: b.entries.length })} label={t('songbook.pick')} busy={busy} onPick={() => void add(b.id, b.name)} />
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('bulk.songbookHint')}</p>
      <CreateRow placeholder={t('songbook.namePlaceholder')} label={t('bulk.createSongbook')} busy={busy} onCreate={async (name) => add(await createSongbook(name), name)} />
    </Modal>
  )
}
