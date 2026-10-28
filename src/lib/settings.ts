import { createContext, useContext, useSyncExternalStore } from 'react'
import { DEFAULT_REMINDER_DAYS } from './backupReminder'

// Per-device UI preferences. Kept in localStorage (not in the backup) and safe when storage is blocked.

export type Theme = 'light' | 'dark'

const listeners = new Set<() => void>()
const memory = new Map<string, string>()

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    memory.set(key, value)
  }
  listeners.forEach((l) => l())
}

function useKey(key: string) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => read(key),
  )
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121212' : '#ffffff')
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme: Theme = useKey('bepro.theme') === 'dark' ? 'dark' : 'light'
  return [
    theme,
    (t) => {
      write('bepro.theme', t)
      applyTheme(t)
    },
  ]
}

export function useReminderDays(): [number, (d: number) => void] {
  const raw = useKey('bepro.reminderDays')
  const days = raw === null ? DEFAULT_REMINDER_DAYS : Number(raw)
  return [Number.isFinite(days) ? days : DEFAULT_REMINDER_DAYS, (d) => write('bepro.reminderDays', String(d))]
}

export function getReminderDays() {
  const raw = read('bepro.reminderDays')
  return raw === null ? DEFAULT_REMINDER_DAYS : Number(raw)
}

export function getSnoozeUntil() {
  return Number(read('bepro.snoozeUntil') ?? 0)
}

export function setSnoozeUntil(t: number) {
  write('bepro.snoozeUntil', String(t))
}

export type ViewMode = 'list' | 'grid'
export function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const v: ViewMode = useKey('bepro.view') === 'grid' ? 'grid' : 'list'
  return [v, (m) => write('bepro.view', m)]
}

/** Whether the sheet details panel is expanded. Remembered per device. */
export function useSheetInfoOpen(): [boolean, (open: boolean) => void] {
  const open = useKey('bepro.sheetInfoOpen') !== '0'
  return [open, (o) => write('bepro.sheetInfoOpen', o ? '1' : '0')]
}

export type SheetMode = 'edit' | 'view'
export function useSheetMode(): [SheetMode, (m: SheetMode) => void] {
  const m: SheetMode = useKey('bepro.sheetMode') === 'view' ? 'view' : 'edit'
  return [m, (v) => write('bepro.sheetMode', v)]
}

/** How large sheets are drawn, in percent (TAB / staff scores, chord charts, numbered notation). */
export const SCORE_ZOOMS = [25, 35, 50, 60, 75, 90, 100, 110, 125, 150, 175, 200]
/** Inside it (the PDF / print page) sheets are laid out for A4 paper: 100 %, one page wide. */
export const PrintLayout = createContext(false)

export function useScoreZoom(): [number, (z: number) => void] {
  const raw = Number(useKey('bepro.scoreZoom') ?? 100)
  const print = useContext(PrintLayout)
  return [print ? 100 : raw >= 25 && raw <= 300 ? raw : 100, (z) => write('bepro.scoreZoom', String(z))]
}

/** Two-page mode: sheets laid out like an open book, left page then right page. */
export function useTwoPage(): [boolean, (on: boolean) => void] {
  const on = useKey('bepro.twoPage') === '1'
  const print = useContext(PrintLayout)
  return [on && !print, (v) => write('bepro.twoPage', v ? '1' : '0')]
}

/** Keep the player controls at the top of the screen while scrolling. */
export function usePlayerPinned(): [boolean, (on: boolean) => void] {
  const on = useKey('bepro.playerPinned') === '1'
  return [on, (v) => write('bepro.playerPinned', v ? '1' : '0')]
}

/** Keep the fretboard docked at the bottom of the screen while scrolling. */
export function useFretPanelPinned(): [boolean, (on: boolean) => void] {
  const on = useKey('bepro.fretPanelPinned') === '1'
  return [on, (v) => write('bepro.fretPanelPinned', v ? '1' : '0')]
}

/** A hand-picked fretboard range for one sheet: from a note (or a whole measure) to a note (or a whole measure). */
export interface CustomRange {
  from: { m: number; b: number | null } // 0-based measure; beat index, or null for the whole measure
  to: { m: number; b: number | null }
}

export function useCustomRange(sheetId: string): [CustomRange | null, (r: CustomRange) => void] {
  const raw = useKey(`bepro.customRange.${sheetId}`)
  let value: CustomRange | null = null
  try {
    const v = raw ? (JSON.parse(raw) as CustomRange) : null
    if (v && Number.isInteger(v.from?.m) && Number.isInteger(v.to?.m)) value = v
  } catch {
    /* ignore a broken value */
  }
  return [value, (r) => write(`bepro.customRange.${sheetId}`, JSON.stringify(r))]
}

/** Measures per fretboard range window; 0 = whole sheet, -1 = a custom range. */
export function useRangeSize(): [number, (n: number) => void] {
  const raw = Number(useKey('bepro.rangeSize') ?? 1)
  return [Number.isFinite(raw) ? raw : 1, (n) => write('bepro.rangeSize', String(n))]
}

export type FretLabels = 'degree' | 'note'
export function useFretLabels(): [FretLabels, (l: FretLabels) => void] {
  const l: FretLabels = useKey('bepro.fretLabels') === 'note' ? 'note' : 'degree'
  return [l, (v) => write('bepro.fretLabels', v)]
}

export function useChordTones(): [boolean, (on: boolean) => void] {
  const on = useKey('bepro.chordTones') === '1'
  return [on, (v) => write('bepro.chordTones', v ? '1' : '0')]
}

export function useKeypad(): [boolean, (on: boolean) => void] {
  const raw = useKey('bepro.keypad')
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  return [raw === null ? coarse : raw === '1', (on) => write('bepro.keypad', on ? '1' : '0')]
}

export function useFretPanelOpen(): [boolean, (open: boolean) => void] {
  const open = useKey('bepro.fretPanel') !== '0'
  return [open, (o) => write('bepro.fretPanel', o ? '1' : '0')]
}

/** Active playback sound: 'builtin' or the id of an imported SoundFont asset. */
export function useSoundFont(): [string, (id: string) => void] {
  return [useKey('bepro.soundfont') ?? 'builtin', (id) => write('bepro.soundfont', id)]
}

export function getSoundFont() {
  return read('bepro.soundfont') ?? 'builtin'
}

export function useMetronome(): [boolean, (on: boolean) => void] {
  const on = useKey('bepro.metronome') === '1'
  return [on, (v) => write('bepro.metronome', v ? '1' : '0')]
}

export function useCountIn(): [boolean, (on: boolean) => void] {
  const on = useKey('bepro.countIn') === '1'
  return [on, (v) => write('bepro.countIn', v ? '1' : '0')]
}

export type SourcePanelMode = 'hidden' | 'top' | 'side'
export function useSourcePanel(): [SourcePanelMode, (m: SourcePanelMode) => void] {
  const raw = useKey('bepro.sourcePanel')
  const mode: SourcePanelMode = raw === 'hidden' || raw === 'top' ? raw : 'side'
  return [mode, (m) => write('bepro.sourcePanel', m)]
}
