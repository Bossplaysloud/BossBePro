import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { addToSongbook, createSongbook } from '../db/repo'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { useToast } from './Toast'

/** From a sheet: add it to one or more songbooks (again, if it is already there), or to a new one. */
export function AddToSongbookDialog({ open, onClose, sheetId }: { open: boolean; onClose: () => void; sheetId: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const books = useLiveQuery(() => db.songbooks.orderBy('order').toArray(), []) ?? []
  const [name, setName] = useState('')

  const add = async (id: string, bookName: string) => {
    await addToSongbook(id, [sheetId])
    toast(t('songbook.added', { name: bookName }))
  }
  const createAndAdd = async () => {
    const n = name.trim()
    if (!n) return
    const id = await createSongbook(n)
    await add(id, n)
    setName('')
  }

  return (
    <Modal open={open} onClose={onClose} title={t('songbook.addToTitle')} actions={<button className="btn btn-primary" onClick={onClose}>{t('common.close')}</button>}>
      {books.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('songbook.none')}</p>}
      <div className="songbook-picker">
        {books.map((b) => {
          const times = b.entries.filter((e) => e.sheetId === sheetId).length
          return (
            <div key={b.id} className={`songbook-pick${times ? ' picked' : ''}`}>
              <Icon name="book" />
              <div className="body">
                <div className="title">{b.name}</div>
                <div className="meta">
                  {t('songbook.songs', { count: b.entries.length })}
                  {times ? ` · ${t('songbook.alreadyIn', { count: times })}` : ''}
                </div>
              </div>
              <button className="btn" onClick={() => void add(b.id, b.name)}>
                <Icon name="plus" />
                {times ? t('songbook.addAgain') : t('songbook.pick')}
              </button>
            </div>
          )
        })}
      </div>
      <div className="row">
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={t('songbook.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void createAndAdd()}
        />
        <button className="btn" disabled={!name.trim()} onClick={() => void createAndAdd()}>{t('songbook.createAndAdd')}</button>
      </div>
    </Modal>
  )
}
