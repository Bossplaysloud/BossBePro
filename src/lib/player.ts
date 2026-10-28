import type { AlphaTabApi } from '@coderline/alphatab'

// Imperative alphaTab player controls, kept out of React components (the API is an external, mutable object).

export function setSpeed(api: AlphaTabApi, speed: number) {
  api.playbackSpeed = speed
}

export function setMetronome(api: AlphaTabApi, on: boolean) {
  api.metronomeVolume = on ? 1 : 0
}

export function setCountIn(api: AlphaTabApi, on: boolean) {
  api.countInVolume = on ? 1 : 0
}

/** Loops bars [from, to) of the rendered score; `null` turns looping off. */
export function setLoop(api: AlphaTabApi, bars: [number, number] | null) {
  const masterBars = api.score?.masterBars
  if (!bars || !masterBars?.length) {
    api.isLooping = false
    api.playbackRange = null
    return
  }
  const from = Math.min(bars[0], masterBars.length - 1)
  const last = masterBars[Math.min(bars[1], masterBars.length) - 1] ?? masterBars[from]
  api.playbackRange = { startTick: masterBars[from].start, endTick: last.start + last.calculateDuration() }
  api.isLooping = true
}

/** Plays from the start of bar `m` (unless a loop range is active). */
export function playFromBar(api: AlphaTabApi, m: number | null) {
  if (m !== null && !api.isLooping) {
    const bar = api.score?.masterBars[m]
    if (bar) api.tickPosition = bar.start
  }
  api.play()
}

/**
 * alphaTab 1.8.4's worker synth wrapper has a self-recursive `loadedMidiInfo` getter, so subscribing to
 * `midiLoaded` overflows the stack. Point the getter at its backing field. Remove once fixed upstream.
 */
export function patchMidiInfoGetter(api: AlphaTabApi) {
  const instance = (api.player as unknown as { _instance?: object } | null)?._instance
  if (!instance) return
  const proto = Object.getPrototypeOf(instance)
  const desc = Object.getOwnPropertyDescriptor(proto, 'loadedMidiInfo')
  if (desc?.get && /return this\.loadedMidiInfo/.test(desc.get.toString())) {
    Object.defineProperty(proto, 'loadedMidiInfo', {
      configurable: true,
      get(this: { _loadedMidiInfo?: unknown }) {
        return this._loadedMidiInfo
      },
    })
  }
}
