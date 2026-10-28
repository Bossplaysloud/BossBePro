import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { exportBackupToFile } from '../db/backup'
import { getMeta, setMeta } from '../db/db'
import { SNOOZE_MS, shouldRemind } from '../lib/backupReminder'
import { getReminderDays, getSnoozeUntil, setSnoozeUntil } from '../lib/settings'
import { Modal } from './Modal'
import { useToast } from './Toast'

/** Checks on launch (and when the app returns to the foreground) whether to nudge the user to back up. */
export function BackupReminder() {
  const { t } = useTranslation()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [neverBackedUp, setNeverBackedUp] = useState(false)
  const days = getReminderDays()

  useEffect(() => {
    const check = async () => {
      let firstUseAt = await getMeta<number>('firstUseAt')
      if (!firstUseAt) {
        firstUseAt = Date.now()
        await setMeta('firstUseAt', firstUseAt)
      }
      const lastBackupAt = await getMeta<number>('lastBackupAt')
      const remind = shouldRemind({
        reminderDays: getReminderDays(),
        lastBackupAt,
        lastChangeAt: await getMeta<number>('lastChangeAt'),
        firstUseAt,
        snoozeUntil: getSnoozeUntil(),
      })
      setNeverBackedUp(!lastBackupAt)
      if (remind) setOpen(true)
    }
    void check()
    const onVisible = () => document.visibilityState === 'visible' && void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const later = () => {
    setSnoozeUntil(Date.now() + SNOOZE_MS)
    setOpen(false)
  }

  const backupNow = async () => {
    if (await exportBackupToFile()) {
      toast(t('reminder.exported'))
      setOpen(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('reminder.title')}
      onClose={later}
      actions={
        <>
          <button className="btn" onClick={later}>{t('reminder.later')}</button>
          <button className="btn btn-primary" onClick={() => void backupNow()} autoFocus>{t('reminder.now')}</button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{neverBackedUp ? t('reminder.bodyNever') : t('reminder.body', { days })}</p>
    </Modal>
  )
}
