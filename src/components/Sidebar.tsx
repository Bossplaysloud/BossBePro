import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { db, type Section, type Songbook } from '../db/db'
import { createSection, createSongbook, reorder } from '../db/repo'
import { DeleteGroupsDialog } from './DeleteGroupsDialog'
import { Icon } from './Icon'
import { PromptModal } from './Modal'
import { SortableList, useSortableItem } from './Sortable'

/** In manage mode an item is a checkbox row: no link, no dragging. */
function CheckItem({ name, count, checked, onToggle }: { name: string; count: number; checked: boolean; onToggle: () => void }) {
  return (
    <label className={`nav-item manage-item${checked ? ' checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="name">{name}</span>
      <span className="count">{count}</span>
    </label>
  )
}

function SectionItem({ section, count, onNavigate }: { section: Section; count: number; onNavigate: () => void }) {
  const { t } = useTranslation()
  const { ref, style, handleProps } = useSortableItem(section.id)
  return (
    <div ref={ref} style={style}>
      <NavLink to={`/section/${section.id}`} className="nav-item" onClick={onNavigate}>
        <span className="grip" {...handleProps} aria-label={t('sheet.dragHandle')} onClick={(e) => e.preventDefault()}>
          <Icon name="grip" size={14} />
        </span>
        <span className="name">{section.name}</span>
        <span className="count">{count}</span>
      </NavLink>
    </div>
  )
}

function SongbookItem({ book, onNavigate }: { book: Songbook; onNavigate: () => void }) {
  const { t } = useTranslation()
  const { ref, style, handleProps } = useSortableItem(book.id)
  return (
    <div ref={ref} style={style}>
      <NavLink to={`/songbook/${book.id}`} className="nav-item" onClick={onNavigate}>
        <span className="grip" {...handleProps} aria-label={t('sheet.dragHandle')} onClick={(e) => e.preventDefault()}>
          <Icon name="grip" size={14} />
        </span>
        <span className="name">{book.name}</span>
        <span className="count">{book.entries.length}</span>
      </NavLink>
    </div>
  )
}

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const sections = useLiveQuery(() => db.sections.orderBy('order').toArray(), []) ?? []
  const sheets = useLiveQuery(() => db.sheets.toArray(), []) ?? []
  const songbooks = useLiveQuery(() => db.songbooks.orderBy('order').toArray(), []) ?? []
  const [creating, setCreating] = useState(false)
  const [creatingBook, setCreatingBook] = useState(false)
  const [managing, setManaging] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const stopManaging = () => {
    setManaging(false)
    setPicked(new Set())
  }
  const pickedSections = sections.filter((s) => picked.has(s.id))
  const pickedBooks = songbooks.filter((b) => picked.has(b.id))

  const countIn = (id: string | null) => sheets.filter((s) => s.sectionId === id).length

  return (
    <nav className={`sidebar${open ? ' open' : ''}`} aria-label={t('nav.menu')}>
      <Link to="/" className="brand" onClick={onNavigate} aria-label={t('nav.home')}>
        <img src="./favicon.svg" alt="" />
        {t('app.name')}
      </Link>

      <NavLink to="/" end className="nav-item" onClick={onNavigate}>
        <Icon name="home" />
        <span className="name">{t('nav.home')}</span>
      </NavLink>
      <NavLink to="/all" className="nav-item" onClick={onNavigate}>
        <Icon name="library" />
        <span className="name">{t('nav.allSheets')}</span>
        <span className="count">{sheets.length}</span>
      </NavLink>
      <NavLink to="/unsorted" className="nav-item" onClick={onNavigate}>
        <Icon name="inbox" />
        <span className="name">{t('nav.unsorted')}</span>
        <span className="count">{countIn(null)}</span>
      </NavLink>

      <div className="nav-label nav-label-row">
        <span>{t('nav.sections')}</span>
        {(sections.length > 0 || songbooks.length > 0) && (
          <button className="link-btn" onClick={() => (managing ? stopManaging() : setManaging(true))}>{managing ? t('manage.done') : t('manage.manage')}</button>
        )}
      </div>
      {managing ? (
        sections.map((s) => <CheckItem key={s.id} name={s.name} count={countIn(s.id)} checked={picked.has(s.id)} onToggle={() => toggle(s.id)} />)
      ) : (
        <SortableList ids={sections.map((s) => s.id)} onReorder={(ids) => void reorder('sections', ids)}>
          {sections.map((s) => (
            <SectionItem
              key={s.id}
              section={s}
              count={countIn(s.id)}
              onNavigate={onNavigate}
            />
          ))}
        </SortableList>
      )}
      {!managing && (
        <button className="nav-item muted" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          {t('section.new')}
        </button>
      )}

      <div className="nav-label">{t('nav.songbooks')}</div>
      {managing ? (
        songbooks.map((b) => <CheckItem key={b.id} name={b.name} count={b.entries.length} checked={picked.has(b.id)} onToggle={() => toggle(b.id)} />)
      ) : (
        <SortableList ids={songbooks.map((b) => b.id)} onReorder={(ids) => void reorder('songbooks', ids)}>
          {songbooks.map((b) => (
            <SongbookItem key={b.id} book={b} onNavigate={onNavigate} />
          ))}
        </SortableList>
      )}
      {!managing && (
        <button className="nav-item muted" onClick={() => setCreatingBook(true)}>
          <Icon name="book" />
          {t('songbook.new')}
        </button>
      )}

      {/* Manage mode: tick sections and songbooks, then delete them together. */}
      {managing && (
        <div className="manage-bar">
          <span className="muted small">{t('manage.hint')}</span>
          <div className="row">
            <button className="btn" onClick={() => setPicked(picked.size === sections.length + songbooks.length ? new Set() : new Set([...sections, ...songbooks].map((x) => x.id)))}>{t('manage.selectAll')}</button>
            <button className="btn btn-danger" disabled={!picked.size} onClick={() => setDeleting(true)}>{t('manage.deleteSelected', { count: picked.size })}</button>
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <NavLink to="/settings" className="nav-item" onClick={onNavigate}>
          <Icon name="settings" />
          {t('nav.settings')}
        </NavLink>
      </div>

      <DeleteGroupsDialog
        open={deleting}
        sections={pickedSections}
        songbooks={pickedBooks}
        sheetCount={sheets.filter((x) => x.sectionId && picked.has(x.sectionId)).length}
        onClose={() => setDeleting(false)}
        onDone={() => {
          // Leave a page whose section or songbook no longer exists.
          const gone = [...picked].some((id) => location.hash.includes(id))
          stopManaging()
          if (gone) navigate('/')
        }}
      />
      <PromptModal
        open={creating}
        title={t('section.new')}
        placeholder={t('section.namePlaceholder')}
        confirmLabel={t('common.create')}
        cancelLabel={t('common.cancel')}
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          setCreating(false)
          const id = await createSection(name)
          onNavigate()
          navigate(`/section/${id}`)
        }}
      />
      <PromptModal
        open={creatingBook}
        title={t('songbook.new')}
        placeholder={t('songbook.namePlaceholder')}
        confirmLabel={t('common.create')}
        cancelLabel={t('common.cancel')}
        onClose={() => setCreatingBook(false)}
        onSubmit={async (name) => {
          setCreatingBook(false)
          const id = await createSongbook(name)
          onNavigate()
          navigate(`/songbook/${id}`)
        }}
      />
    </nav>
  )
}
