import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackupError, parseBackup, restoreBackup, type BackupFile, type RestoreMode } from '../db/backup'
import { ConfirmModal, Modal } from './Modal'
import { useToast } from './Toast'

/** Opens a file picker; once a valid backup is chosen, asks merge vs replace. */
export function useRestore() {
  const { t } = useTranslation()
  const toast = useToast()
  const [backup, setBackup] = useState<BackupFile | null>(null)

  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        setBackup(parseBackup(await file.text()))
      } catch (e) {
        toast(t(e instanceof BackupError && e.code === 'newerFormat' ? 'restore.newerFormat' : 'restore.invalid'))
      }
    }
    input.click()
  }

  const dialog = <RestoreDialog backup={backup} onClose={() => setBackup(null)} />
  return { pick, dialog }
}

function RestoreDialog({ backup, onClose }: { backup: BackupFile | null; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [mode, setMode] = useState<RestoreMode>('merge')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!backup) return
    setBusy(true)
    try {
      const r = await restoreBackup(backup, mode)
      toast(t('restore.done', { ...r }))
      onClose()
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <>
      <Modal
        open={!!backup && !confirming}
        locked={busy}
        title={t('restore.title')}
        onClose={onClose}
        actions={
          <>
            <button className="btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => (mode === 'replace' ? setConfirming(true) : void run())}>
              {t('restore.start')}
            </button>
          </>
        }
      >
        {backup && (
          <p className="muted small" style={{ margin: 0 }}>
            {t('restore.fileInfo', {
              date: new Date(backup.exportedAt).toLocaleString(i18n.language),
              sheets: backup.data.sheets.length,
              sections: backup.data.sections.length,
            })}
          </p>
        )}
        {(['merge', 'replace'] as const).map((m) => (
          <label key={m} className="choice">
            <input type="radio" name="restore-mode" checked={mode === m} onChange={() => setMode(m)} />
            <span>
              <strong>{t(`restore.${m}`)}</strong>
              <br />
              <span className="muted small">{t(`restore.${m}Hint`)}</span>
            </span>
          </label>
        ))}
      </Modal>
      <ConfirmModal
        open={confirming}
        danger
        title={t('restore.replaceConfirmTitle')}
        body={t('restore.replaceConfirmBody')}
        confirmLabel={t('restore.replaceConfirm')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirming(false)}
        onConfirm={() => void run()}
      />
    </>
  )
}
