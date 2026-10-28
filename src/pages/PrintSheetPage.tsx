import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { db } from '../db/db'
import { Icon } from '../components/Icon'
import { PrintLayout } from '../lib/settings'
import { SheetView } from './SongbookReader'

/** Present in the desktop app (BePro-Desktop): saves the page as a PDF file directly. */
const desktop = (window as Window & { beproDesktop?: { savePdf: (title: string) => Promise<{ saved: boolean }> } }).beproDesktop

/**
 * A sheet laid out for A4 paper, for "export PDF": only the music (read-only, 100 %, one page
 * wide), then the browser's print window opens, where "Save as PDF" makes the file. The page
 * title becomes the sheet title, which browsers use as the PDF's file name.
 */
export function PrintSheetPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const sheet = useLiveQuery(async () => (await db.sheets.get(id!)) ?? null, [id])
  const bodyRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const printed = useRef(false)

  useEffect(() => {
    if (!sheet) return
    const before = document.title
    document.title = sheet.title
    return () => void (document.title = before)
  }, [sheet])

  // Ready when fonts are in and the music has stopped changing for a moment (the score is drawn
  // in pieces, pictures and PDF pages load one by one); at most 15 seconds.
  useEffect(() => {
    if (!sheet || !bodyRef.current) return
    let timer = 0
    let done = false
    const settle = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const imgs = [...(bodyRef.current?.querySelectorAll('img') ?? [])]
        if (imgs.some((i) => !i.complete)) return settle()
        done = true
        setReady(true)
      }, 1200)
    }
    const observer = new MutationObserver(() => !done && settle())
    observer.observe(bodyRef.current, { childList: true, subtree: true, attributes: true })
    void document.fonts.ready.then(settle)
    const cap = window.setTimeout(() => {
      done = true
      setReady(true)
    }, 15000)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
      window.clearTimeout(cap)
    }
  }, [sheet])

  // The web version opens the print window ("Save as PDF" there); the desktop app asks where to save.
  const output = () => (desktop && sheet ? void desktop.savePdf(sheet.title) : window.print())

  useEffect(() => {
    if (!ready || printed.current) return
    printed.current = true
    output()
  })

  if (sheet === null) return <Navigate to="/" replace />
  if (sheet === undefined) return null

  return (
    <PrintLayout.Provider value>
      <div className="print-page">
        <div className="print-toolbar">
          <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label={t('common.back')} title={t('common.back')}>
            <Icon name="back" />
          </button>
          <span className="muted small" style={{ flex: 1 }}>{ready ? t(desktop ? 'pdf.hintDesktop' : 'pdf.hint') : t('pdf.preparing')}</span>
          <button className="btn btn-primary" disabled={!ready} onClick={output}>
            <Icon name="download" />
            {t(desktop ? 'pdf.saveFile' : 'pdf.saveAgain')}
          </button>
        </div>
        <div ref={bodyRef} className="print-sheet">
          {/* Scores and numbered notation print their own title. */}
          {(sheet.type === 'chord' || sheet.type === 'image') && <h1 className="print-title">{sheet.title}</h1>}
          <SheetView sheet={sheet} />
        </div>
      </div>
    </PrintLayout.Provider>
  )
}
