import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { exportBackupToFile } from '../db/backup'
import { db, newId } from '../db/db'
import { AiSettingsPanel } from '../components/AiSettings'
import { ConfirmModal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { useRestore } from '../components/RestoreDialog'
import { useToast } from '../components/Toast'
import { LANGUAGES, setLang, type Lang } from '../i18n'
import { useReminderDays, useSoundFont, useTheme } from '../lib/settings'

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [theme, setTheme] = useTheme()
  const [days, setDays] = useReminderDays()
  const restore = useRestore()
  const lastBackupAt = useLiveQuery(async () => (await db.meta.get('lastBackupAt'))?.value as number | undefined, [])
  const [storage, setStorage] = useState<{ used: number; persisted: boolean } | null>(null)
  const [soundFont, setSoundFont] = useSoundFont()
  const soundFonts = useLiveQuery(() => db.assets.where('kind').equals('soundfont').toArray(), []) ?? []
  const [deletingSf, setDeletingSf] = useState<{ id: string; name: string } | null>(null)

  const importSoundFont = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.sf2,.sf3'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      // SoundFonts are RIFF files of form type "sfbk".
      const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
      const tag = (a: number, b: number) => String.fromCharCode(...head.slice(a, b))
      if (tag(0, 4) !== 'RIFF' || tag(8, 12) !== 'sfbk') return toast(t('sound.invalid'))
      const id = newId()
      const now = Date.now()
      await db.assets.add({ id, kind: 'soundfont', name: file.name, mime: 'audio/x-soundfont', blob: file, createdAt: now, updatedAt: now })
      setSoundFont(id)
      toast(t('sound.imported', { name: file.name }))
    }
    input.click()
  }

  useEffect(() => {
    void (async () => {
      try {
        const est = await navigator.storage?.estimate()
        const persisted = (await navigator.storage?.persisted?.()) ?? false
        if (est) setStorage({ used: est.usage ?? 0, persisted })
      } catch {
        /* not supported */
      }
    })()
  }, [])

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <h1>{t('settings.title')}</h1>
      </div>

      <section className="panel">
        <h2>{t('settings.appearance')}</h2>
        <div className="setting-row">
          <span>{t('settings.theme')}</span>
          <div className="segmented" role="group" aria-label={t('settings.theme')}>
            {(['light', 'dark'] as const).map((x) => (
              <button key={x} aria-pressed={theme === x} onClick={() => setTheme(x)}>{t(`settings.${x}`)}</button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span>{t('settings.language')}</span>
          <div className="segmented" role="group" aria-label={t('settings.language')}>
            {LANGUAGES.map((l) => (
              <button key={l.code} aria-pressed={i18n.language === l.code} onClick={() => setLang(l.code as Lang)}>{l.label}</button>
            ))}
          </div>
        </div>
      </section>

      <AiSettingsPanel />

      <section className="panel">
        <h2>{t('sound.title')}</h2>
        <p className="muted small" style={{ marginTop: -6 }}>{t('sound.hint')}</p>
        <div className="stack" style={{ gap: 8 }}>
          {[{ id: 'builtin', name: t('sound.builtin'), size: 1351896 }, ...soundFonts.map((a) => ({ id: a.id, name: a.name, size: a.blob.size }))].map((sf) => (
            <label key={sf.id} className="choice">
              <input type="radio" name="soundfont" checked={soundFont === sf.id} onChange={() => setSoundFont(sf.id)} />
              <span style={{ flex: 1 }}>
                <strong>{sf.name}</strong>
                <br />
                <span className="muted small">{formatBytes(sf.size)}</span>
              </span>
              {sf.id !== 'builtin' && (
                <button className="btn btn-ghost btn-icon" aria-label={t('common.delete')} onClick={(e) => (e.preventDefault(), setDeletingSf(sf))}>
                  <Icon name="trash" />
                </button>
              )}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={importSoundFont}>
            <Icon name="upload" />
            {t('sound.import')}
          </button>
          <span className="muted small">{t('sound.importHint')}</span>
        </div>
      </section>

      <ConfirmModal
        open={!!deletingSf}
        danger
        title={t('sound.deleteTitle')}
        body={t('sound.deleteBody', { name: deletingSf?.name })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeletingSf(null)}
        onConfirm={() => {
          if (deletingSf) {
            void db.assets.delete(deletingSf.id)
            if (soundFont === deletingSf.id) setSoundFont('builtin')
          }
          setDeletingSf(null)
        }}
      />

      <section className="panel">
        <h2>{t('settings.backup')}</h2>
        <div className="setting-row">
          <span>{t('settings.lastBackup')}</span>
          <strong>{lastBackupAt ? new Date(lastBackupAt).toLocaleString(i18n.language) : t('settings.never')}</strong>
        </div>
        <div className="setting-row">
          <div>
            <div>{t('settings.exportBackup')}</div>
            <div className="muted small">{t('settings.exportHint')}</div>
          </div>
          <button className="btn btn-primary" onClick={() => void exportBackupToFile().then((ok) => ok && toast(t('reminder.exported')))}>
            <Icon name="download" />
            {t('settings.exportBackup')}
          </button>
        </div>
        <div className="setting-row">
          <div>
            <div>{t('settings.restore')}</div>
            <div className="muted small">{t('settings.restoreHint')}</div>
          </div>
          <button className="btn" onClick={restore.pick}>
            <Icon name="upload" />
            {t('settings.restore')}
          </button>
        </div>
        <div className="setting-row">
          <span>{t('settings.reminder')}</span>
          <select className="select" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>{t('settings.reminderEvery', { count: d })}</option>
            ))}
            <option value={0}>{t('settings.reminderOff')}</option>
          </select>
        </div>
        {storage && (
          <div className="setting-row">
            <div>
              <div>{t('settings.storage')}</div>
              <div className="muted small">{storage.persisted ? t('settings.persisted') : t('settings.notPersisted')}</div>
            </div>
            <span className="muted">{t('settings.storageUsed', { used: formatBytes(storage.used) })}</span>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>{t('settings.about')}</h2>
        <p className="muted small" style={{ margin: 0 }}>{t('settings.credits')}</p>
      </section>
      {restore.dialog}
    </div>
  )
}
