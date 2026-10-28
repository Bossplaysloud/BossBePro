import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AlphaTabApi } from '@coderline/alphatab'
import { PROGRAMS } from '../music/instruments'
import { setCountIn as setPlayerCountIn, setLoop as setPlayerLoop, setMetronome as setPlayerMetronome, setSpeed as setPlayerSpeed } from '../lib/player'
import { useCountIn, useMetronome, usePlayerPinned } from '../lib/settings'
import { Icon } from './Icon'
import type { PlayerStatus } from './ScoreView'
import { useToast } from './Toast'

interface Props {
  api: AlphaTabApi | null
  status: PlayerStatus
  /** Increments whenever a new MIDI is ready (bar ticks may have changed). */
  midiVersion: number
  tempo: number // the sheet's written tempo
  program: number
  onProgram: (p: number) => void
  measures: number
  /** Default loop range: the fretboard's current window [from, to). */
  range: [number, number]
  onPlay: () => void
  onStop: () => void
}

const MIN_SPEED = 0.25
const MAX_SPEED = 2

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
let iosHintShown = false

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function PlayerBar({ api, status, midiVersion, tempo, program, onProgram, measures, range, onPlay, onStop }: Props) {
  const { t } = useTranslation()
  const [pinned, setPinned] = usePlayerPinned()
  const toast = useToast()
  const [speed, setSpeed] = useState(1)
  const [metronome, setMetronome] = useMetronome()
  const [countIn, setCountIn] = useCountIn()
  const [loop, setLoop] = useState(false)
  const [loopFrom, setLoopFrom] = useState(0)
  const [loopTo, setLoopTo] = useState(1) // exclusive
  const bpm = Math.round(tempo * speed)

  useEffect(() => {
    if (api) setPlayerSpeed(api, speed)
  }, [api, speed])

  useEffect(() => {
    if (api) setPlayerMetronome(api, metronome)
  }, [api, metronome])

  useEffect(() => {
    if (api) setPlayerCountIn(api, countIn)
  }, [api, countIn])

  // Loop range in ticks from the rendered score; recomputed whenever the MIDI is rebuilt.
  useEffect(() => {
    if (api) setPlayerLoop(api, loop ? [loopFrom, loopTo] : null)
  }, [api, loop, loopFrom, loopTo, midiVersion])

  const setBpm = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return
    setSpeed(Math.min(MAX_SPEED, Math.max(MIN_SPEED, value / tempo)))
  }

  const toggleLoop = () => {
    if (!loop) {
      setLoopFrom(range[0])
      setLoopTo(Math.max(range[0] + 1, range[1]))
    }
    setLoop(!loop)
  }

  const play = () => {
    if (status.playing) return api?.pause()
    if (isIOS() && !iosHintShown) {
      iosHintShown = true
      toast(t('player.iosSilent'))
    }
    onPlay()
  }

  return (
    <div className={`player-bar${pinned ? ' pinned' : ''}`} role="group" aria-label={t('player.title')}>
      <button className="btn btn-primary player-play" onClick={play} disabled={!status.ready} aria-label={status.playing ? t('player.pause') : t('player.play')} title={`${status.playing ? t('player.pause') : t('player.play')} (Shift+Space)`}>
        <Icon name={status.playing ? 'pause' : 'play'} />
      </button>
      <button className="btn btn-icon" onClick={onStop} disabled={!status.ready} aria-label={t('player.stop')} title={t('player.stop')}>
        <Icon name="stop" />
      </button>
      <span className="player-time small muted">{status.ready ? `${clock(status.time)} / ${clock(status.end)}` : status.error ? t('player.soundMissing') : t('player.loading')}</span>

      <span className="tab-toolbar-sep" />

      <div className="player-tempo">
        <button className="btn btn-icon" onClick={() => setBpm(bpm - 5)} aria-label="−5 BPM">−</button>
        <label className="row small" style={{ gap: 4 }}>
          ♩=
          <input
            key={bpm}
            className="input"
            type="number"
            min={Math.round(tempo * MIN_SPEED)}
            max={Math.round(tempo * MAX_SPEED)}
            defaultValue={bpm}
            aria-label={t('player.bpm')}
            onBlur={(e) => setBpm(Number(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <button className="btn btn-icon" onClick={() => setBpm(bpm + 5)} aria-label="+5 BPM">+</button>
        <input
          type="range"
          min={MIN_SPEED * 100}
          max={MAX_SPEED * 100}
          step={5}
          value={Math.round(speed * 100)}
          onChange={(e) => setSpeed(Number(e.target.value) / 100)}
          aria-label={t('player.speed')}
        />
        <button className="btn speed-label" onClick={() => setSpeed(1)} title={t('player.resetSpeed')}>{Math.round(speed * 100)}%</button>
      </div>

      <span className="tab-toolbar-sep" />

      <button className="btn" aria-pressed={metronome} onClick={() => setMetronome(!metronome)}>{t('player.metronome')}</button>
      <button className="btn" aria-pressed={countIn} onClick={() => setCountIn(!countIn)} title={t('player.countInHint')}>{t('player.countIn')}</button>
      <button className="btn" aria-pressed={loop} onClick={toggleLoop} title={t('player.loopHint')}>{t('player.loop')}</button>
      {loop && (
        <span className="row small" style={{ gap: 4 }}>
          <select className="select" value={loopFrom} onChange={(e) => { const v = Number(e.target.value); setLoopFrom(v); if (loopTo <= v) setLoopTo(v + 1) }} aria-label={t('player.loopFrom')}>
            {Array.from({ length: measures }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
          </select>
          –
          <select className="select" value={loopTo - 1} onChange={(e) => { const v = Number(e.target.value); setLoopTo(v + 1); if (v < loopFrom) setLoopFrom(v) }} aria-label={t('player.loopTo')}>
            {Array.from({ length: measures }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
          </select>
          {t('player.bars')}
        </span>
      )}

      <select className="select" value={program} onChange={(e) => onProgram(Number(e.target.value))} aria-label={t('player.sound')} title={t('player.sound')}>
        {PROGRAMS.map((p) => <option key={p} value={p}>{t(`program.${p}`)}</option>)}
      </select>

      <span className="spacer" />
      <label className="pin-toggle" title={t('player.pinHint')}>
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        {t('player.pin')}
      </label>
    </div>
  )
}
