import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { db } from '../db/db'
import { deleteSection, deleteSheet, renameSection, reorder } from '../db/repo'
import { Icon } from '../components/Icon'
import { ConfirmModal, PromptModal } from '../components/Modal'
import { NewSheetDialog } from '../components/NewSheetDialog'
import { SheetCard } from '../components/SheetCard'
import { SortableList } from '../components/Sortable'
import { pickScoreFile } from '../lib/pickFiles'
import { useViewMode } from '../lib/settings'
import { GP_EXTENSIONS } from '../music/gpImport'

type Scope = { kind: 'all' } | { kind: 'unsorted' } | { kind: 'section'; id: string }

export function LibraryPage({ scope: fixed }: { scope?: Scope }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const params = useParams()
  const scope: Scope = fixed ?? { kind: 'section', id: params.id! }

  const sections = useLiveQuery(() => db.sections.orderBy('order').toArray(), [])
  const allSheets = useLiveQuery(() => db.sheets.orderBy('order').toArray(), [])
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [view, setView] = useViewMode()
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Selecting several sheets (to delete them together).
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deletingMany, setDeletingMany] = useState(false)

  const section = scope.kind === 'section' ? sections?.find((s) => s.id === scope.id) : undefined
  const sectionNames = useMemo(() => new Map(sections?.map((s) => [s.id, s.name])), [sections])

  // 'all' | 'unsorted' | section id
  const scopeKey = scope.kind === 'section' ? scope.id : scope.kind
  const inScope = useMemo(
    () =>
      (allSheets ?? []).filter((s) =>
        scopeKey === 'all' ? true : scopeKey === 'unsorted' ? s.sectionId === null : s.sectionId === scopeKey,
      ),
    [allSheets, scopeKey],
  )
  const tags = useMemo(() => [...new Set(inScope.flatMap((s) => s.tags))].sort(), [inScope])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inScope.filter(
      (s) =>
        (!tag || s.tags.includes(tag)) &&
        (!q || s.title.toLowerCase().includes(q) || s.tags.some((x) => x.toLowerCase().includes(q))),
    )
  }, [inScope, query, tag])

  if (!sections || !allSheets) return null
  if (scope.kind === 'section' && !section) return <Navigate to="/" replace />

  const title = scope.kind === 'all' ? t('nav.allSheets') : scope.kind === 'unsorted' ? t('nav.unsorted') : section!.name

  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
        {section && (
          <>
            <button className="btn btn-ghost btn-icon" title={t('common.rename')} aria-label={t('common.rename')} onClick={() => setRenaming(true)}>
              <Icon name="edit" />
            </button>
            <button className="btn btn-ghost btn-icon" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleting(true)}>
              <Icon name="trash" />
            </button>
          </>
        )}
        <button className="btn" onClick={() => pickScoreFile(GP_EXTENSIONS, (file) => navigate('/import-gp', { state: { file, sectionId: section?.id ?? null } }))}>
          <Icon name="upload" />
          {t('gp.button')}
        </button>
        <button className="btn" onClick={() => navigate('/recognize')}>
          <Icon name="camera" />
          {t('ai.fromImage')}
        </button>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          {t('sheet.new')}
        </button>
      </div>

      {inScope.length > 0 && (
        <div className="toolbar">
          <input className="input search" type="search" placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          {tags.length > 0 && (
            <select className="select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label={t('sheet.tags')}>
              <option value="">{t('view.allTags')}</option>
              {tags.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          )}
          <button className="btn" aria-pressed={selecting} onClick={() => (setSelecting(!selecting), setSelected(new Set()))}>
            {selecting ? t('multiSelect.done') : t('multiSelect.start')}
          </button>
          <div className="segmented" role="group">
            <button aria-pressed={view === 'list'} onClick={() => setView('list')} title={t('view.list')} aria-label={t('view.list')}>
              <Icon name="list" />
            </button>
            <button aria-pressed={view === 'grid'} onClick={() => setView('grid')} title={t('view.grid')} aria-label={t('view.grid')}>
              <Icon name="grid" />
            </button>
          </div>
        </div>
      )}

      {selecting && (
        <div className="select-bar">
          <span>{t('multiSelect.count', { count: selected.size })}</span>
          <button className="btn" onClick={() => setSelected(new Set(visible.map((s) => s.id)))}>{t('multiSelect.all')}</button>
          <button className="btn" disabled={!selected.size} onClick={() => setSelected(new Set())}>{t('multiSelect.none')}</button>
          <span className="spacer" />
          <button className="btn btn-danger" disabled={!selected.size} onClick={() => setDeletingMany(true)}>
            <Icon name="trash" />
            {t('multiSelect.delete', { count: selected.size })}
          </button>
        </div>
      )}

      {inScope.length === 0 ? (
        <div className="empty">
          <h2>{t('sheet.empty')}</h2>
          <p>{t('sheet.emptyHint')}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <h2>{t('sheet.noResults')}</h2>
        </div>
      ) : (
        <SortableList ids={visible.map((s) => s.id)} onReorder={(ids) => void reorder('sheets', ids)} grid={view === 'grid'}>
          <div className={view === 'grid' ? 'sheet-grid' : 'sheet-list'}>
            {visible.map((s) => (
              <SheetCard
                key={s.id}
                sheet={s}
                sectionName={scope.kind === 'all' && s.sectionId ? sectionNames.get(s.sectionId) : undefined}
                selection={
                  selecting
                    ? {
                        selected: selected.has(s.id),
                        onToggle: () =>
                          setSelected((old) => {
                            const next = new Set(old)
                            if (next.has(s.id)) next.delete(s.id)
                            else next.add(s.id)
                            return next
                          }),
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </SortableList>
      )}

      <ConfirmModal
        open={deletingMany}
        danger
        title={t('multiSelect.deleteTitle')}
        body={t('multiSelect.deleteBody', { count: selected.size })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeletingMany(false)}
        onConfirm={async () => {
          setDeletingMany(false)
          for (const id of selected) await deleteSheet(id)
          setSelected(new Set())
          setSelecting(false)
        }}
      />
      <NewSheetDialog open={creating} onClose={() => setCreating(false)} sectionId={section?.id ?? null} />
      <PromptModal
        open={renaming}
        title={t('section.renameTitle')}
        initial={section?.name}
        confirmLabel={t('common.save')}
        cancelLabel={t('common.cancel')}
        onClose={() => setRenaming(false)}
        onSubmit={(name) => {
          if (section) void renameSection(section.id, name)
          setRenaming(false)
        }}
      />
      <ConfirmModal
        open={deleting}
        danger
        title={t('section.deleteTitle')}
        body={t('section.deleteBody', { name: section?.name, count: inScope.length })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false)
          if (section) void deleteSection(section.id).then(() => navigate('/unsorted'))
        }}
      />
    </div>
  )
}
