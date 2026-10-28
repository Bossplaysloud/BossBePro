import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { Section, Sheet } from '../db/db'
import { addImagePages, deleteSheet, moveImagePage, removeImagePage, updateSheet } from '../db/repo'
import { AddToSongbookDialog } from '../components/AddToSongbookDialog'
import { Icon } from '../components/Icon'
import { ImageSheetView } from '../components/ImageSheetView'
import { ConfirmModal } from '../components/Modal'
import { isImageSheetContent } from '../music/imageSheet'
import { pickSheetFiles } from '../lib/pickFiles'

/**
 * A picture / PDF sheet: the files are the sheet, shown for reading. Files can be added, removed
 * and reordered; to edit the music it has to be turned into notation by recognition first.
 */
export function ImageSheetPage({ sheet, sections }: { sheet: Sheet; sections: Section[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [toSongbook, setToSongbook] = useState(false)
  const [wantEdit, setWantEdit] = useState(false)
  const [tagsDraft, setTagsDraft] = useState<string | null>(null)
  const pages = isImageSheetContent(sheet.content) ? sheet.content.pages : []
  const save = (changes: Parameters<typeof updateSheet>[1]) => void updateSheet(sheet.id, changes)

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label={t('common.back')} title={t('common.back')}>
          <Icon name="back" />
        </button>
        <input
          className="input"
          style={{ flex: 1, fontSize: '1.4rem', fontWeight: 700, border: 'none', padding: '4px 0', background: 'transparent' }}
          aria-label={t('sheet.title')}
          defaultValue={sheet.title}
          key={sheet.id}
          onBlur={(e) => e.target.value.trim() && e.target.value !== sheet.title && save({ title: e.target.value.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button className="btn" title={t('songbook.addToTitle')} onClick={() => setToSongbook(true)}>
          <Icon name="book" />
          <span className="hide-narrow">{t('songbook.addTo')}</span>
        </button>
        <button className="btn" title={t('pdf.exportTitle')} onClick={() => navigate(`/sheet/${sheet.id}/pdf`)}>
          <Icon name="download" />
          <span className="hide-narrow">{t('pdf.export')}</span>
        </button>
        <button className="btn btn-ghost btn-icon" aria-label={t('common.delete')} title={t('common.delete')} onClick={() => setDeleting(true)}>
          <Icon name="trash" />
        </button>
      </div>

      <section className="panel stack">
        <div className="field-row">
          <label className="field">
            <span>{t('sheet.section')}</span>
            <select className="select" value={sheet.sectionId ?? ''} onChange={(e) => save({ sectionId: e.target.value || null })}>
              <option value="">{t('nav.unsorted')}</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('sheet.tags')}</span>
            <input
              className="input"
              placeholder={t('sheet.tagsPlaceholder')}
              value={tagsDraft ?? sheet.tags.join(', ')}
              onChange={(e) => setTagsDraft(e.target.value)}
              onBlur={() => {
                if (tagsDraft === null) return
                save({ tags: [...new Set(tagsDraft.split(/[,，]/).map((x) => x.trim()).filter(Boolean))] })
                setTagsDraft(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        </div>
        <div className="row">
          <span className="muted small" style={{ flex: 1 }}>{t('imageSheet.readOnly', { count: pages.length })}</span>
          <button className="btn" onClick={() => pickSheetFiles((files) => void addImagePages(sheet.id, files))}>
            <Icon name="upload" />
            {t('imageSheet.addFiles')}
          </button>
        </div>
        <label className="choice">
          <input type="checkbox" checked={wantEdit} onChange={(e) => setWantEdit(e.target.checked)} />
          <span style={{ flex: 1 }}>
            <strong>{t('imageSheet.wantEdit')}</strong>
            <br />
            <span className="muted small">{t('imageSheet.wantEditHint')}</span>
          </span>
        </label>
        {wantEdit && (
          <div className="row">
            <span className="spacer" />
            <button className="btn btn-primary" disabled={!pages.length} onClick={() => navigate(`/recognize?from=${sheet.id}`)}>
              <Icon name="camera" />
              {t('imageSheet.toRecognize')}
            </button>
          </div>
        )}
      </section>

      <ImageSheetView pages={pages} onRemove={(assetId) => void removeImagePage(sheet.id, assetId)} onMove={(assetId, dir) => void moveImagePage(sheet.id, assetId, dir)} />

      <AddToSongbookDialog open={toSongbook} onClose={() => setToSongbook(false)} sheetId={sheet.id} />
      <ConfirmModal
        open={deleting}
        danger
        title={t('sheet.deleteTitle')}
        body={t('sheet.deleteBody', { name: sheet.title })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          const back = sheet.sectionId ? `/section/${sheet.sectionId}` : '/unsorted'
          void deleteSheet(sheet.id).then(() => navigate(back, { replace: true }))
        }}
      />
    </div>
  )
}
