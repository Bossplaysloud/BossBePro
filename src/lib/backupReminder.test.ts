import { describe, expect, it } from 'vitest'
import { DAY, shouldRemind } from './backupReminder'

const now = 100 * DAY

describe('shouldRemind', () => {
  it('stays quiet with no changes', () => {
    expect(shouldRemind({ reminderDays: 7, firstUseAt: 0 }, now)).toBe(false)
  })
  it('reminds when never backed up and first use is old enough', () => {
    expect(shouldRemind({ reminderDays: 7, firstUseAt: now - 8 * DAY, lastChangeAt: now - DAY }, now)).toBe(true)
    expect(shouldRemind({ reminderDays: 7, firstUseAt: now - 3 * DAY, lastChangeAt: now - DAY }, now)).toBe(false)
  })
  it('needs changes after the last backup', () => {
    expect(shouldRemind({ reminderDays: 7, lastBackupAt: now - 10 * DAY, lastChangeAt: now - 11 * DAY }, now)).toBe(false)
    expect(shouldRemind({ reminderDays: 7, lastBackupAt: now - 10 * DAY, lastChangeAt: now - DAY }, now)).toBe(true)
  })
  it('respects snooze and off', () => {
    const base = { lastBackupAt: now - 10 * DAY, lastChangeAt: now - DAY }
    expect(shouldRemind({ ...base, reminderDays: 7, snoozeUntil: now + 1 }, now)).toBe(false)
    expect(shouldRemind({ ...base, reminderDays: 0 }, now)).toBe(false)
  })
})
