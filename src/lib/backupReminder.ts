export const DAY = 24 * 60 * 60 * 1000
export const DEFAULT_REMINDER_DAYS = 7
export const SNOOZE_MS = DAY

export interface ReminderState {
  reminderDays: number // 0 = off
  lastBackupAt?: number
  lastChangeAt?: number
  firstUseAt?: number
  snoozeUntil?: number
}

/** Remind when there are unsaved changes and the last backup (or first use) is older than the interval. */
export function shouldRemind(s: ReminderState, now = Date.now()): boolean {
  if (s.reminderDays <= 0) return false
  if (!s.lastChangeAt) return false
  if (s.lastBackupAt && s.lastChangeAt <= s.lastBackupAt) return false
  if (s.snoozeUntil && now < s.snoozeUntil) return false
  const since = s.lastBackupAt ?? s.firstUseAt ?? s.lastChangeAt
  return now - since >= s.reminderDays * DAY
}
