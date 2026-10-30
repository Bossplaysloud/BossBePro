import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteSection, deleteSongbook } from '../db/repo'
import { Modal } from './Modal'

/**
 * Deletes sections and/or songbooks. When the sections hold sheets, asks whether to delete those
 * sheets too; "No" (the default button) moves them to unsorted. Songbooks only list sheets, so
 * deleting one never deletes a sheet.
 */
export function DeleteGroupsDialog({ open, sections, songbooks = [], sheetCount, onClose, onDone }: {
  open: boolean
  sections: { id: string; name: string }[]
  songbooks?: { id: string; name: string }[]
  /** Sheets in the given sections. */
  sheetCount: number
  onClose: () => void
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const keepRef = useRef<HTMLButtonElement>(null)
  const ask = sections.length > 0 && sheetCount > 0
  // The dialog focuses its first button when it opens; "No" is the default, so move focus there.
  useEffect(() => {
    if (!open || !ask) return
    const id = window.setTimeout(() => keepRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open, ask])
  const names = [...sections, ...songbooks].map((x) => `「${x.name}」`).join('、')

  const run = async (withSheets: boolean) => {
    setBusy(true)
    try {
      for (const s of sections) await deleteSection(s.id, withSheets)
      for (const b of songbooks) await deleteSongbook(b.id)
    } finally {
      setBusy(false)
    }
    onClose()
    onDone?.()
  }

  return (
    <Modal
      open={open}
      locked={busy}
      onClose={onClose}
      title={t('manage.deleteTitle', { count: sections.length + songbooks.length })}
      actions={
        ask ? (
          <>
            <button className="btn" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => void run(true)}>{t('manage.withSheetsYes')}</button>
            <button ref={keepRef} className="btn btn-primary" disabled={busy} onClick={() => void run(false)}>{t('manage.withSheetsNo')}</button>
          </>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => void run(false)}>{t('common.delete')}</button>
          </>
        )
      }
    >
      <p style={{ margin: 0 }}>{t('manage.deleteWhat', { names })}</p>
      {ask && (
        <>
          <p style={{ margin: 0 }}><strong>{t('manage.withSheetsQuestion', { count: sheetCount })}</strong></p>
          <p className="muted small" style={{ margin: 0 }}>{t('manage.withSheetsHint')}</p>
        </>
      )}
      {songbooks.length > 0 && <p className="muted small" style={{ margin: 0 }}>{t('manage.songbookHint')}</p>}
    </Modal>
  )
}
