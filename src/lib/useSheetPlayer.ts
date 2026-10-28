import { useCallback, useEffect, useRef, useState } from 'react'
import type { AlphaTabApi } from '@coderline/alphatab'
import type { PlayerStatus } from '../components/ScoreView'
import { playFromBar } from './player'

/** While the score is hidden (editing), it is re-rendered for playback after typing pauses. */
const HIDDEN_TEX_DELAY = 800

/**
 * Playback state for a sheet workspace. `tex` is the latest score; when `live` (the score is on
 * screen) it updates right away, otherwise after a pause. During playback the score is frozen
 * so the music does not restart. `focus` is the bar playback starts from after a full stop.
 */
export function useSheetPlayer(tex: string, live: boolean, focus: number) {
  const [api, setApi] = useState<AlphaTabApi | null>(null)
  const [status, setStatus] = useState<PlayerStatus>({ ready: false, playing: false, time: 0, end: 0 })
  const [midiVersion, setMidiVersion] = useState(0)
  const [playing, setPlaying] = useState<{ m: number; b: number } | null>(null)
  const pendingPlay = useRef(false)
  const stopped = useRef(true)

  const [hiddenTex, setHiddenTex] = useState(tex)
  useEffect(() => {
    if (status.playing || tex === hiddenTex) return
    const timer = setTimeout(() => setHiddenTex(tex), live ? 0 : HIDDEN_TEX_DELAY)
    return () => clearTimeout(timer)
  }, [tex, hiddenTex, live, status.playing])
  const playerTex = live && !status.playing ? tex : hiddenTex

  const startPlayback = useCallback(() => {
    if (!api) return
    // From a full stop, start at the bar being looked at; after a pause, resume.
    playFromBar(api, stopped.current ? focus : null)
    stopped.current = false
  }, [api, focus])

  const onPlay = useCallback(() => {
    if (!api) return
    if (playerTex !== tex) {
      pendingPlay.current = true
      setHiddenTex(tex) // play once the new MIDI is ready
    } else startPlayback()
  }, [api, playerTex, tex, startPlayback])

  const onStop = useCallback(() => {
    api?.stop()
    stopped.current = true
    setPlaying(null)
  }, [api])

  const onMidiReady = () => {
    setMidiVersion((v) => v + 1)
    if (pendingPlay.current) {
      pendingPlay.current = false
      startPlayback()
    }
  }

  const onStatus = (s: PlayerStatus) => {
    setStatus(s)
    if (!s.playing && s.end > 0 && s.time >= s.end) stopped.current = true
  }

  // Shift+Space toggles playback anywhere on the page (except while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !e.shiftKey) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      if (status.playing) api?.pause()
      else onPlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api, status.playing, onPlay])

  return { api, setApi, status, onStatus, midiVersion, playing, setPlaying, playerTex, onPlay, onStop, onMidiReady }
}
