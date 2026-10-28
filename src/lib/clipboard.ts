import { useSyncExternalStore } from 'react'
import type { Beat, Measure } from '../music/rhythm'

/** Beats copied in an editor. Lives for the session, so it can be pasted into another sheet. */
export interface BeatClip {
  kind: 'tab' | 'melody'
  beats: Beat[]
  /** Set when whole measures were copied, so pasting at a bar start inserts bars. */
  measures?: Measure[]
}

let clip: BeatClip | null = null
const listeners = new Set<() => void>()

export function setClip(next: BeatClip) {
  clip = next
  listeners.forEach((l) => l())
}

export function getClip() {
  return clip
}

export function useClip() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => clip,
  )
}
