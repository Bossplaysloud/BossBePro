import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useScoreZoom, useTwoPage } from '../lib/settings'
import { ZoomSelect } from './ZoomSelect'
import type { AlphaTabApi } from '@coderline/alphatab'
import { db } from '../db/db'
import { patchMidiInfoGetter } from '../lib/player'
import { getSoundFont, useTheme } from '../lib/settings'

export interface PlayerStatus {
  ready: boolean // sound loaded and score prepared
  playing: boolean
  time: number // ms
  end: number // ms
  error?: boolean
}

interface Props {
  tex: string
  /** Shown as the score (view mode) or rendered off-screen only to drive playback (edit mode). */
  visible: boolean
  /** TAB staff or standard notation. */
  profile?: 'tab' | 'score'
  /** Measures [from, to) to highlight. */
  range: [number, number]
  onMeasureClick: (m: number) => void
  onApi: (api: AlphaTabApi | null) => void
  onBeat: (pos: { m: number; b: number } | null) => void
  onStatus: (s: PlayerStatus) => void
  /** Called whenever a new MIDI is ready (after the score was re-rendered). */
  onMidiReady?: () => void
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function colors(dark: boolean) {
  const main = dark ? '#ececea' : '#1a1a1a'
  const muted = dark ? '#9a9a95' : '#6b6b66'
  return {
    mainGlyphColor: main,
    secondaryGlyphColor: muted,
    scoreInfoColor: main,
    staffLineColor: dark ? '#555' : '#bdbdb7',
    barSeparatorColor: muted,
    barNumberColor: muted,
  }
}

const PAGE_GAP = 40

/**
 * Two-page layout: alphaTab draws the score as blocks stacked top to bottom (title, then one block
 * per line of music). They are dealt onto pages as tall as the visible area: down the left page,
 * then down the right page, then the next spread below. With no width, nothing is moved.
 */
function arrangePages(host: HTMLElement | null, width: number | null) {
  const surface = host?.querySelector<HTMLElement>('.at-surface')
  if (!surface || !width) return
  const blocks = [...surface.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.style.position === 'absolute')
  blocks.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
  const scroller = host!.closest<HTMLElement>('.reader-body, .main')
  const pageHeight = Math.max(320, (scroller?.clientHeight ?? window.innerHeight) - 72)
  let column = 0
  let y = 0
  for (const block of blocks) {
    const h = parseFloat(block.style.height) || block.offsetHeight
    if (y > 0 && y + h > pageHeight) {
      column++
      y = 0
    }
    block.style.left = `${(column % 2) * (width + PAGE_GAP)}px`
    block.style.top = `${Math.floor(column / 2) * pageHeight + y}px`
    y += h
  }
  surface.style.width = `${2 * width + PAGE_GAP}px`
  surface.style.height = `${(Math.floor(column / 2) + 1) * pageHeight}px`
}

/** Renders alphaTex with alphaTab (loaded on demand), highlights the measure range and runs playback. */
export function ScoreView({ tex, visible, profile = 'tab', range, onMeasureClick, onApi, onBeat, onStatus, onMidiReady }: Props) {
  const { t } = useTranslation()
  const [theme] = useTheme()
  const [zoom] = useScoreZoom()
  const scale = 0.95 * (zoom / 100)
  // Two-page mode: the score is laid out at half width, then its lines are dealt onto a left and
  // a right page, one spread after another (see `arrangePages`).
  const [twoPage] = useTwoPage()
  const wrapRef = useRef<HTMLDivElement>(null)
  // Height of the last finished layout: kept while a new one is drawn, so the page does not collapse.
  const lastHeight = useRef(0)
  const [wrapWidth, setWrapWidth] = useState(0)
  const pageWidth = twoPage && wrapWidth ? Math.max(240, Math.floor((wrapWidth - PAGE_GAP) / 2)) : null
  const pages = useRef<number | null>(null)
  pages.current = pageWidth
  // One layout at a time: a request during a layout runs once that one has finished.
  const layoutState = useRef({ busy: false, again: false })
  const relayout = () => {
    const api = apiRef.current
    if (!api) return
    if (layoutState.current.busy) layoutState.current.again = true
    else api.render()
  }
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<AlphaTabApi | null>(null)
  const [rendered, setRendered] = useState(false)
  const [boxes, setBoxes] = useState<Box[]>([])
  const latest = useRef({ range, onMeasureClick, onBeat, onStatus, onMidiReady, visible })
  latest.current = { range, onMeasureClick, onBeat, onStatus, onMidiReady, visible }
  const status = useRef<PlayerStatus>({ ready: false, playing: false, time: 0, end: 0 })
  const emit = (patch: Partial<PlayerStatus>) => {
    status.current = { ...status.current, ...patch }
    latest.current.onStatus(status.current)
  }

  const measureBoxes = () => {
    const lookup = apiRef.current?.boundsLookup
    if (!lookup || !latest.current.visible) return setBoxes([])
    const [from, to] = latest.current.range
    const out: Box[] = []
    for (let i = from; i < to; i++) {
      const b = lookup.findMasterBarByIndex(i)?.realBounds
      if (b) out.push({ x: b.x, y: b.y, w: b.w, h: b.h })
    }
    setBoxes(out)
  }

  // Create the API once.
  // The score is (re)created when two-page mode is switched or its page width changes: alphaTab
  // reuses its blocks between layouts, which leaves stray blocks when the width changes; a fresh one is clean.
  useEffect(() => {
    let disposed = false
    // In two-page mode, wait until the page width is known: the score is laid out at that width.
    if (twoPage && !pageWidth) return
    if (hostRef.current) hostRef.current.innerHTML = ''
    setRendered(false)
    void import('@coderline/alphatab').then(async (at) => {
      if (disposed || !hostRef.current) return
      const soundFont = getSoundFont()
      const api = new at.AlphaTabApi(hostRef.current, {
        // Workers need bundler integration that alphaTab 1.8's Vite plugin fails to provide; main-thread rendering is fine at this size.
        core: { engine: 'svg', enableLazyLoading: false, useWorkers: false, fontDirectory: new URL('alphatab/font/', document.baseURI).href },
        display: { layoutMode: at.LayoutMode.Page, staveProfile: profile === 'tab' ? at.StaveProfile.Tab : at.StaveProfile.Score, scale, resources: colors(theme === 'dark') },
        // Default dynamics ('f') and the placeholder track name add noise to a practice sheet.
        notation: {
          elements: new Map([
            [at.NotationElement.EffectDynamics, false],
            [at.NotationElement.TrackNames, false],
          ]),
        },
        player: {
          playerMode: at.PlayerMode.EnabledSynthesizer,
          // The script-processor output needs no extra worklet file (see the worker note above).
          outputMode: at.PlayerOutputMode.WebAudioScriptProcessor,
          soundFont: soundFont === 'builtin' ? new URL('alphatab/soundfont/sonivox.sf2', document.baseURI).href : null,
          enableCursor: true,
          enableUserInteraction: false,
          scrollElement: (document.querySelector('.main') as HTMLElement | null) ?? 'html,body',
          scrollMode: latest.current.visible ? at.ScrollMode.Continuous : at.ScrollMode.Off,
        },
      })
      patchMidiInfoGetter(api)
      api.renderStarted.on(() => (layoutState.current.busy = true))
      api.postRenderFinished.on(() => {
        layoutState.current.busy = false
        if (layoutState.current.again) {
          layoutState.current.again = false
          api.render()
          return
        }
        setRendered(true)
        arrangePages(hostRef.current, pages.current)
        lastHeight.current = wrapRef.current?.offsetHeight ?? 0
        measureBoxes()
      })
      api.playerReady.on(() => emit({ ready: true }))
      api.playerStateChanged.on((e) => emit({ playing: e.state === at.synth.PlayerState.Playing }))
      api.playerPositionChanged.on((e) => emit({ time: e.currentTime, end: e.endTime }))
      api.playedBeatChanged.on((beat) => latest.current.onBeat({ m: beat.voice.bar.index, b: beat.index }))
      api.playerFinished.on(() => latest.current.onBeat(null))
      api.midiLoaded.on(() => {
        const cb = latest.current.onMidiReady
        if (cb) setTimeout(cb, 0)
      })
      apiRef.current = api
      onApi(api)
      api.tex(tex)

      if (soundFont !== 'builtin') {
        // Imported SoundFont stored on this device.
        const asset = await db.assets.get(soundFont)
        if (disposed) return
        if (asset) api.loadSoundFont(new Uint8Array(await asset.blob.arrayBuffer()), false)
        else emit({ error: true })
      }
    })
    return () => {
      disposed = true
      apiRef.current?.destroy()
      apiRef.current = null
      onApi(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twoPage, twoPage ? pageWidth : 0])

  useEffect(() => {
    apiRef.current?.tex(tex)
  }, [tex])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    Object.assign(api.settings.display.resources, colors(theme === 'dark'))
    api.updateSettings()
    api.render()
  }, [theme])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    void import('@coderline/alphatab').then((at) => {
      api.settings.player.scrollMode = visible ? at.ScrollMode.Continuous : at.ScrollMode.Off
      api.updateSettings()
      if (visible) api.render() // layout depends on the now-visible width
    })
  }, [visible])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // Small changes (a scroll bar appearing while the score grows, then going) do not lay the
    // two pages out again: that made the score jump back and forth.
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      setWrapWidth((prev) => (!prev || Math.abs(w - prev) > 24 ? w : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A new display size: lay the score out again at that scale.
  useEffect(() => {
    const api = apiRef.current
    if (!api || api.settings.display.scale === scale) return
    api.settings.display.scale = scale
    api.updateSettings()
    relayout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  useEffect(measureBoxes, [range[0], range[1], visible])

  const onClick = (e: React.MouseEvent) => {
    // In two-page mode the lines have moved, so positions no longer match the score's own layout.
    if (pageWidth) return
    const api = apiRef.current
    const host = hostRef.current
    if (!api?.boundsLookup || !host) return
    const r = host.getBoundingClientRect()
    const beat = api.boundsLookup.getBeatAtPos(e.clientX - r.left, e.clientY - r.top)
    if (beat) latest.current.onMeasureClick(beat.voice.bar.index)
  }

  return (
    <div className={`score-view${visible ? '' : ' offscreen'}${pageWidth ? ' two-page' : ''}`} aria-hidden={!visible}>
      {visible && <ZoomSelect />}
      <div ref={wrapRef} style={{ position: 'relative', minHeight: rendered ? undefined : lastHeight.current || undefined }}>
        {/* Two pages are dealt out only once the whole score is drawn: hide it until then. */}
        <div ref={hostRef} onClick={onClick} style={pageWidth ? { width: pageWidth, visibility: rendered ? undefined : 'hidden' } : undefined} />
        {!pageWidth && boxes.map((b, i) => (
          <div key={i} className="score-range" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
        ))}
      </div>
      {visible && !rendered && (
        <div className={`score-status${pageWidth ? ' busy' : ''}`} role="status">
          {pageWidth && <span className="spinner" aria-hidden />}
          {pageWidth ? t('view.arrangingTwoPage') : t('tab.rendering')}
        </div>
      )}
    </div>
  )
}
