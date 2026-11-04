import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/db'
import { flushPendingSaves } from '../lib/pendingSaves'
import { canExportGp, gpFileName, sheetToGp } from '../music/gpExport'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { useToast } from './Toast'

type Format = 'pdf' | 'gp'

/**
 * "Export file" from the home page: find one sheet, then save it as PDF (any sheet, through the
 * A4 print page) or as a Guitar Pro file (TAB, staff and numbered sheets), after a note on what a
 * .gp file keeps and which programs open it. From a sheet's own page (`fixedId`) that sheet is
 * already chosen.
 */
export function ExportSheetDialog({ open, onClose, fixedId }: { open: boolean; onClose: () => void; fixedId?: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const sheets = useLiveQuery(() => db.sheets.orderBy('updatedAt').reverse().toArray(), []) ?? []
  const [query, setQuery] = useState('')
  const [pickedId, setSheetId] = useState<string | null>(null)
  const sheetId = fixedId ?? pickedId
  const [format, setFormat] = useState<Format | null>(null)
  const [busy, setBusy] = useState(false)
  const sheet = sheets.find((s) => s.id === sheetId) ?? null
  const gpOk = !!sheet && canExportGp(sheet)
  const q = query.trim().toLowerCase()
  const shown = sheets.filter((s) => !q || s.title.toLowerCase().includes(q) || s.tags.some((x) => x.toLowerCase().includes(q)))

  const close = () => {
    setQuery('')
    setSheetId(null)
    setFormat(null)
    onClose()
  }

  const run = async () => {
    if (!sheet || !format) return
    // Edits still waiting to be saved go in first.
    await flushPendingSaves()
    if (format === 'pdf') {
      close()
      navigate(`/sheet/${sheet.id}/pdf`)
      return
    }
    setBusy(true)
    try {
      const bytes = await sheetToGp((await db.sheets.get(sheet.id)) ?? sheet)
      if (!bytes) return
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
      const a = document.createElement('a')
      a.href = url
      a.download = gpFileName(sheet.title)
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
      toast(t('exportFile.gpSaved', { name: a.download }))
      close()
    } catch {
      toast(t('exportFile.gpFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      locked={busy}
      onClose={close}
      title={t('exportFile.title')}
      actions={
        <>
          <button className="btn" disabled={busy} onClick={close}>{t('common.cancel')}</button>
          {sheet && (
            <button className="btn btn-primary" disabled={!format || busy} onClick={() => void run()}>
              <Icon name="download" />
              {format === 'gp' ? t('exportFile.downloadGp') : t('exportFile.toPdf')}
            </button>
          )}
        </>
      }
    >
      {!sheet ? (
        <>
          <input className="input" type="search" autoFocus placeholder={t('dash.search')} aria-label={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="export-list">
            {shown.length === 0 && <p className="muted small" style={{ margin: 0 }}>{sheets.length ? t('sheet.noResults') : t('dash.noSheets')}</p>}
            {shown.map((s) => (
              <button key={s.id} className="dash-row export-row" onClick={() => (setSheetId(s.id), setFormat(null))}>
                <span className="dash-dot" style={{ '--c': `var(--type-${s.type})` } as CSSProperties} />
                <span className="dash-row-title">{s.title}</span>
                <span className="dash-row-type">{t(`sheetType.${s.type}`)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <strong style={{ flex: 1, minWidth: 0 }}>{sheet.title}</strong>
            {!fixedId && <button className="btn btn-ghost" disabled={busy} onClick={() => (setSheetId(null), setFormat(null))}>{t('exportFile.change')}</button>}
          </div>
          <label className="choice">
            <input type="radio" name="export-format" checked={format === 'pdf'} onChange={() => setFormat('pdf')} />
            <span>
              <strong>PDF</strong>
              <br />
              <span className="muted small">{t('exportFile.pdfHint')}</span>
            </span>
          </label>
          <label className={`choice${gpOk ? '' : ' disabled'}`}>
            <input type="radio" name="export-format" disabled={!gpOk} checked={format === 'gp'} onChange={() => setFormat('gp')} />
            <span>
              <strong>{t('exportFile.gp')}</strong>
              <br />
              <span className="muted small">{gpOk ? t(sheet.type === 'numbered' ? 'exportFile.gpHintNumbered' : 'exportFile.gpHint') : t(['tab', 'staff', 'numbered'].includes(sheet.type) ? 'exportFile.gpEmpty' : 'exportFile.gpUnavailable', { type: t(`sheetType.${sheet.type}`) })}</span>
            </span>
          </label>
          {format === 'gp' && (
            <div className="export-note" role="note">
              <strong>{t('exportFile.noteTitle')}</strong>
              <ul>
                {(t('exportFile.notes', { returnObjects: true }) as unknown as string[]).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
