import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { db, type Sheet, type SongbookEntry } from '../db/db'
import { addToSongbook, deleteSongbook, removeSongbookEntry, renameSongbook, reorderSongbook } from '../db/repo'
import { Icon } from '../components/Icon'
import { ConfirmModal, Modal, PromptModal } from '../components/Modal'
import { SortableList, useSortableItem } from '../components/Sortable'
import { TypeBadge } from '../components/TypeBadge'
import { tuningLabel } from '../music/instruments'
import { isImageSheetContent } from '../music/imageSheet'

/** One song in the book: its position, the sheet, and a button to take it out (the sheet stays). */
function EntryCard({ entry, index, sheet, bookId, onRemove }: { entry: SongbookEntry; index: number; sheet: Sheet; bookId: string; onRemove: () => void }) {
  const { t } = useTranslation()
  const { ref, style, isDragging, handleProps } = useSortableItem(entry.id)
  return (
    <Link ref={ref} style={style} to={`/songbook/${bookId}/play/${index + 1}`} className={`sheet-card songbook-entry${isDragging ? ' dragging' : ''}`}>
      <span className="entry-no">{index + 1}</span>
      <div className="body">
        <div className="title">{sheet.title}</div>
        <div className="meta">
          <TypeBadge type={sheet.type} />
          {sheet.type === 'image' ? ` · ${t('imageSheet.files', { count: isImageSheetContent(sheet.content) ? sheet.content.pages.length : 0 })}` : ` · ${t(`instrument.${sheet.instrument}`)} ${tuningLabel(sheet.tuning)}`}
          {sheet.key && sheet.type !== 'image' ? ` · ${sheet.key}` : ''}
        </div>
      </div>
      <Link
        className="btn btn-ghost btn-icon"
        to={`/sheet/${sheet.id}`}
        title={t('reader.edit')}
        aria-label={t('reader.edit')}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon name="edit" />
      </Link>
      <button
        className="btn btn-ghost btn-icon"
        title={t('songbook.remove')}
        aria-label={t('songbook.remove')}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onRemove()
        }}
      >
        <Icon name="close" />
      </button>
      <span className="grip" {...handleProps} aria-label={t('sheet.dragHandle')} onClick={(e) => e.preventDefault()}>
        <Icon name="grip" />
      </span>
    </Link>
  )
}

/** Pick sheets to add; picking a sheet twice adds it twice. */
function AddSheetsDialog({ open, onClose, onAdd, counts }: { open: boolean; onClose: () => void; onAdd: (ids: string[]) => void; counts: Map<string, number> }) {
  const { t } = useTranslation()
  const sheets = useLiveQuery(() => db.sheets.orderBy('order').toArray(), []) ?? []
  const sections = useLiveQuery(() => db.sections.toArray(), []) ?? []
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const names = new Map(sections.map((s) => [s.id, s.name]))
  const q = query.trim().toLowerCase()
  const shown = sheets.filter((s) => !q || s.title.toLowerCase().includes(q) || s.tags.some((x) => x.toLowerCase().includes(q)))
  const close = () => {
    setPicked([])
    setQuery('')
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title={t('songbook.addTitle')}
      wide
      actions={
        <>
          <button className="btn" onClick={close}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!picked.length} onClick={() => (onAdd(picked), close())}>
            {t('songbook.addN', { count: picked.length })}
          </button>
        </>
      }
    >
      <input className="input" type="search" placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <p className="muted small" style={{ margin: 0 }}>{t('songbook.addHint')}</p>
      <div className="songbook-picker">
        {shown.map((s) => {
          const times = picked.filter((id) => id === s.id).length
          const already = counts.get(s.id) ?? 0
          return (
            <div key={s.id} className={`songbook-pick${times ? ' picked' : ''}`}>
              <div className="body">
                <div className="title">{s.title}</div>
                <div className="meta">
                  <TypeBadge type={s.type} />
                  {s.sectionId && names.get(s.sectionId) ? ` · ${names.get(s.sectionId)}` : ''}
                  {already ? ` · ${t('songbook.alreadyIn', { count: already })}` : ''}
                </div>
              </div>
              {times > 0 && (
                <button className="btn btn-icon" onClick={() => setPicked((p) => { const i = p.lastIndexOf(s.id); return p.filter((_, k) => k !== i) })} aria-label={t('songbook.unpick')} title={t('songbook.unpick')}>
                  −
                </button>
              )}
              {times > 0 && <span className="pick-count">×{times}</span>}
              <button className="btn btn-icon" onClick={() => setPicked((p) => [...p, s.id])} aria-label={t('songbook.pick')} title={t('songbook.pick')}>
                <Icon name="plus" />
              </button>
            </div>
          )
        })}
        {!shown.length && <p className="muted">{t('sheet.noResults')}</p>}
      </div>
    </Modal>
  )
}

export function SongbookPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  // undefined while loading, null when there is no such songbook
  const book = useLiveQuery(async () => (await db.songbooks.get(id!)) ?? null, [id])
  const sheets = useLiveQuery(() => db.sheets.toArray(), [])
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const pressedAt = useRef<{ x: number; y: number } | null>(null)
  const byId = useMemo(() => new Map((sheets ?? []).map((s) => [s.id, s])), [sheets])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of book?.entries ?? []) m.set(e.sheetId, (m.get(e.sheetId) ?? 0) + 1)
    return m
  }, [book])

  if (book === null) return <Navigate to="/" replace />
  if (book === undefined || sheets === undefined) return null
  const entries = book.entries.filter((e) => byId.has(e.sheetId))

  return (
    <div className="page">
      <div className="page-header">
        <h1>{book.name}</h1>
        <button className="btn btn-ghost btn-icon" title={t('common.rename')} aria-label={t('common.rename')} onClick={() => setRenaming(true)}>
          <Icon name="edit" />
        </button>
        <button className="btn btn-ghost btn-icon" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleting(true)}>
          <Icon name="trash" />
        </button>
        <span className="muted small">{t('songbook.songs', { count: entries.length })}</span>
        <button className="btn" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          {t('songbook.add')}
        </button>
        {entries.length > 0 && (
          <Link className="btn btn-primary" to={`/songbook/${book.id}/play/1`}>
            <Icon name="read" />
            {t('reader.start')}
          </Link>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <h2>{t('songbook.empty')}</h2>
          <p>{t('songbook.emptyHint')}</p>
        </div>
      ) : (
        <SortableList ids={entries.map((e) => e.id)} onReorder={(ids) => void reorderSongbook(book.id, ids)}>
          <div
            className="sheet-list"
            // Letting go after dragging a song must not open it: a "click" that moved is a drop.
            onPointerDownCapture={(e) => (pressedAt.current = { x: e.clientX, y: e.clientY })}
            onClickCapture={(e) => {
              const p = pressedAt.current
              if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
          >
            {entries.map((e, i) => (
              <EntryCard key={e.id} entry={e} index={i} sheet={byId.get(e.sheetId)!} bookId={book.id} onRemove={() => void removeSongbookEntry(book.id, e.id)} />
            ))}
          </div>
        </SortableList>
      )}

      <AddSheetsDialog open={adding} onClose={() => setAdding(false)} counts={counts} onAdd={(ids) => void addToSongbook(book.id, ids)} />
      <PromptModal
        open={renaming}
        title={t('songbook.renameTitle')}
        initial={book.name}
        confirmLabel={t('common.save')}
        cancelLabel={t('common.cancel')}
        onClose={() => setRenaming(false)}
        onSubmit={(name) => {
          void renameSongbook(book.id, name)
          setRenaming(false)
        }}
      />
      <ConfirmModal
        open={deleting}
        danger
        title={t('songbook.deleteTitle')}
        body={t('songbook.deleteBody', { name: book.name })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false)
          void deleteSongbook(book.id).then(() => navigate('/'))
        }}
      />
    </div>
  )
}
