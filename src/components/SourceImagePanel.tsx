import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { useSourcePanel, type SourcePanelMode } from '../lib/settings'

/** The photos/scans a sheet was recognized from, shown next to the editor for checking and fixing. */
export function SourceImagePanel({ imageIds }: { imageIds: string[] }) {
  const { t } = useTranslation()
  const assets = useLiveQuery(async () => (await db.assets.bulkGet(imageIds)).filter((a) => !!a), [imageIds.join()])
  const [mode, setMode] = useSourcePanel()
  const [zoom, setZoom] = useState(false)
  const urls = useMemo(() => (assets ?? []).map((a) => URL.createObjectURL(a.blob)), [assets])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  if (!assets?.length) return null
  const modes: SourcePanelMode[] = ['hidden', 'top', 'side']
  return (
    <section className={`panel source-panel ${mode}`} aria-label={t('ai.original')}>
      <div className="row">
        <strong>{t('ai.original')}{urls.length > 1 ? `（${urls.length}）` : ''}</strong>
        <span className="spacer" />
        <div className="segmented" role="group">
          {modes.map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{t(`ai.panel.${m}`)}</button>
          ))}
        </div>
        {mode !== 'hidden' && (
          <button className="btn" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{zoom ? t('ai.fit') : t('ai.zoom')}</button>
        )}
      </div>
      {mode !== 'hidden' && urls.length > 0 && (
        <div className={`source-scroll${zoom ? ' zoom' : ''}`}>
          {urls.map((u, i) => (
            <img key={u} src={u} alt={`${t('ai.original')} ${i + 1}`} />
          ))}
        </div>
      )}
    </section>
  )
}
