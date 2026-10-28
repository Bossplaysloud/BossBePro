import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useNavigate } from 'react-router-dom'
import { db, type Section, type Songbook } from '../db/db'
import { createSection, createSongbook, reorder } from '../db/repo'
import { Icon } from './Icon'
import { PromptModal } from './Modal'
import { SortableList, useSortableItem } from './Sortable'

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

  const countIn = (id: string | null) => sheets.filter((s) => s.sectionId === id).length

  return (
    <nav className={`sidebar${open ? ' open' : ''}`} aria-label={t('nav.menu')}>
      <div className="brand">
        <img src="./favicon.svg" alt="" />
        {t('app.name')}
      </div>

      <NavLink to="/" end className="nav-item" onClick={onNavigate}>
        <Icon name="library" />
        <span className="name">{t('nav.allSheets')}</span>
        <span className="count">{sheets.length}</span>
      </NavLink>
      <NavLink to="/unsorted" className="nav-item" onClick={onNavigate}>
        <Icon name="inbox" />
        <span className="name">{t('nav.unsorted')}</span>
        <span className="count">{countIn(null)}</span>
      </NavLink>

      <div className="nav-label">{t('nav.sections')}</div>
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
      <button className="nav-item muted" onClick={() => setCreating(true)}>
        <Icon name="plus" />
        {t('section.new')}
      </button>

      <div className="nav-label">{t('nav.songbooks')}</div>
      <SortableList ids={songbooks.map((b) => b.id)} onReorder={(ids) => void reorder('songbooks', ids)}>
        {songbooks.map((b) => (
          <SongbookItem key={b.id} book={b} onNavigate={onNavigate} />
        ))}
      </SortableList>
      <button className="nav-item muted" onClick={() => setCreatingBook(true)}>
        <Icon name="book" />
        {t('songbook.new')}
      </button>

      <div className="sidebar-footer">
        <NavLink to="/settings" className="nav-item" onClick={onNavigate}>
          <Icon name="settings" />
          {t('nav.settings')}
        </NavLink>
      </div>

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
