import { useTranslation } from 'react-i18next'
import { SCORE_ZOOMS, useScoreZoom, useTwoPage } from '../lib/settings'

/** The sheet's display size in percent and the two-page switch, in the top-right corner of a sheet view. */
export function ZoomSelect({ size = true }: { size?: boolean }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useScoreZoom()
  const [twoPage, setTwoPage] = useTwoPage()
  return (
    <div className="view-zoom">
      <button className="btn" aria-pressed={twoPage} onClick={() => setTwoPage(!twoPage)} title={t('view.twoPageHint')}>
        {t('view.twoPage')}
      </button>
      {size && (
      <select className="select" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label={t('view.zoom')} title={t('view.zoom')}>
        {(SCORE_ZOOMS.includes(zoom) ? SCORE_ZOOMS : [...SCORE_ZOOMS, zoom].sort((a, b) => a - b)).map((z) => (
          <option key={z} value={z}>{z}%</option>
        ))}
      </select>
      )}
    </div>
  )
}
