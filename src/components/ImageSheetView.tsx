import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { openPdf, renderPdfPage } from '../lib/image'
import type { ImageSheetPage } from '../music/imageSheet'
import { Icon } from './Icon'
import { ZoomSelect } from './ZoomSelect'
import { useScoreZoom, useTwoPage } from '../lib/settings'

/** One stored picture, or every page of one stored PDF, drawn at full width. */
function PageFile({ page }: { page: ImageSheetPage }) {
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
        <img key={u} className="image-sheet-page" src={u} alt={`${page.name} ${i + 1}`} draggable={false} />
      ))}
    </>
  )
}

/**
 * The pages of a picture / PDF sheet, top to bottom; with `onRemove` / `onMove` each file can be managed.
 * The display size scales each page; in two-page mode the pages (pictures, or PDF pages) sit two
 * side by side, left page then right page.
 */
export function ImageSheetView({ pages, onRemove, onMove, zoomable = true }: { pages: ImageSheetPage[]; onRemove?: (assetId: string) => void; onMove?: (assetId: string, dir: -1 | 1) => void; zoomable?: boolean }) {
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
          <PageFile page={p} />
        </figure>
      ))}
    </div>
    </>
  )
}
