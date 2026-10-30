import { useLiveQuery } from 'dexie-react-hooks'
import { useContext, useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { openPdf, renderPdfPage } from '../lib/image'
import { imageNotes, isImageSheetContent, type ImageSheetPage, type Sticky } from '../music/imageSheet'
import { Icon } from './Icon'
import { NotesBlock, StickyNote, useNotesShown, type StickyEditor } from './ImageNotes'
import { ZoomSelect } from './ZoomSelect'
import { PrintLayout, useScoreZoom, useTwoPage } from '../lib/settings'

/** One stored picture, or every page of one stored PDF, drawn at full width, with its stickies. */
function PageFile({ page, stickies, edit }: { page: ImageSheetPage; stickies: Sticky[]; edit?: StickyEditor }) {
  const { t } = useTranslation()
  const asset = useLiveQuery(() => db.assets.get(page.assetId), [page.assetId])
  const [urls, setUrls] = useState<string[] | null>(null)

  useEffect(() => {
    if (!asset) return
    let cancelled = false
    const made: string[] = []
    if (page.mime === 'application/pdf') {
      // PDF pages are drawn once into images, sharp enough for a tablet held upright.
      void (async () => {
        try {
          const doc = await openPdf(asset.blob)
          for (let n = 1; n <= doc.numPages && !cancelled; n++) {
            const canvas = await renderPdfPage(doc, n, 1600)
            const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
            if (blob) made.push(URL.createObjectURL(blob))
            if (!cancelled) setUrls([...made])
          }
        } catch {
          if (!cancelled) setUrls([])
        }
      })()
    } else {
      made.push(URL.createObjectURL(asset.blob))
      setUrls([...made])
    }
    return () => {
      cancelled = true
      for (const u of made) URL.revokeObjectURL(u)
    }
  }, [asset, page.mime])

  if (asset === null || (asset === undefined && urls === null)) return asset === null ? <p className="muted">{t('imageSheet.missing')}</p> : null
  if (urls && !urls.length) return <p className="muted">{t('imageSheet.cannotOpen', { name: page.name })}</p>
  return (
    <>
      {(urls ?? []).map((u, i) => (
        <div
          key={u}
          className={`image-sheet-page${edit?.placing ? ' placing' : ''}`}
          onClick={(e) => {
            if (!edit?.placing || e.target !== e.currentTarget.firstChild) return
            const r = e.currentTarget.getBoundingClientRect()
            edit.onPlace(page.assetId, i, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
          }}
        >
          <img className="image-sheet-img" src={u} alt={`${page.name} ${i + 1}`} draggable={false} />
          {stickies.filter((s) => s.page === i).map((s) => (
            <StickyNote key={s.id} sticky={s} edit={edit} />
          ))}
        </div>
      ))}
    </>
  )
}

/**
 * The pages of a picture / PDF sheet, top to bottom; with `onRemove` / `onMove` each file can be managed,
 * with `stickies` the notes stuck on the pages show (and with `edit` can be placed, moved and changed).
 * The display size scales each page; in two-page mode the pages (pictures, or PDF pages) sit two
 * side by side, left page then right page.
 */
export function ImageSheetView({ pages, onRemove, onMove, zoomable = true, stickies = [], edit }: { pages: ImageSheetPage[]; onRemove?: (assetId: string) => void; onMove?: (assetId: string, dir: -1 | 1) => void; zoomable?: boolean; stickies?: Sticky[]; edit?: StickyEditor }) {
  const { t } = useTranslation()
  const [zoom] = useScoreZoom()
  const [twoPage] = useTwoPage()
  if (!pages.length) return <div className="empty"><h2>{t('imageSheet.empty')}</h2><p>{t('imageSheet.emptyHint')}</p></div>
  return (
    <>
    {zoomable && <ZoomSelect />}
    <div className={`image-sheet${twoPage ? ' two-page' : ''}`} style={{ '--page-zoom': zoomable ? zoom / 100 : 1 } as CSSProperties}>
      {pages.map((p, i) => (
        <figure key={p.assetId} className="image-sheet-file">
          {(onRemove || onMove) && (
            <figcaption className="image-sheet-tools">
              <span className="small muted">{i + 1}. {p.name}</span>
              <span className="spacer" />
              {onMove && (
                <>
                  <button className="btn btn-icon" disabled={i === 0} onClick={() => onMove(p.assetId, -1)} aria-label={t('ai.moveUp')} title={t('ai.moveUp')}><Icon name="prev" /></button>
                  <button className="btn btn-icon" disabled={i === pages.length - 1} onClick={() => onMove(p.assetId, 1)} aria-label={t('ai.moveDown')} title={t('ai.moveDown')}><Icon name="next" /></button>
                </>
              )}
              {onRemove && (
                <button className="btn btn-icon" onClick={() => onRemove(p.assetId)} aria-label={t('imageSheet.removeFile')} title={t('imageSheet.removeFile')}><Icon name="trash" /></button>
              )}
            </figcaption>
          )}
          <PageFile page={p} stickies={stickies.filter((s) => s.assetId === p.assetId)} edit={edit} />
        </figure>
      ))}
    </div>
    </>
  )
}

/** A picture / PDF sheet read-only (songbook, PDF): its notes and stickies where the settings allow. */
export function ImageSheetRead({ content }: { content: unknown }) {
  const print = useContext(PrintLayout)
  const notes = imageNotes(content)
  const shown = useNotesShown(notes, print ? 'pdf' : 'songbook')
  const pages = isImageSheetContent(content) ? content.pages : []
  return (
    <>
      {shown && <NotesBlock text={notes.text} />}
      <ImageSheetView pages={pages} zoomable={false} stickies={shown ? notes.stickies : []} />
    </>
  )
}
