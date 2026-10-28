import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { getClip, setClip, useClip, type BeatClip } from '../lib/clipboard'
import {
  beatsInRange,
  clearRange,
  comparePos,
  inRange,
  insertBeatsAt,
  insertMeasuresAt,
  isWholeMeasures,
  measureFill,
  measuresInRange,
  orderRange,
  overwriteAt,
  removeRange,
  stepBeat,
  tsAt,
  type Content,
  type Cursor,
  type Pos,
} from '../music/rhythm'
import { useToast } from './Toast'

interface Options<C extends Content> {
  content: C
  onChange: (fn: (c: C) => C) => void
  cursor: Cursor
  setCursor: (c: Cursor) => void
  timeSignature: [number, number]
  kind: BeatClip['kind']
  /** Converts a clip from another notation into beats/measures for this one (null if impossible). */
  adapt: (clip: BeatClip) => Pick<BeatClip, 'beats' | 'measures'> | null
  /** Plain-text form of copied beats for the system clipboard (TAB only). */
  toText?: (beats: C['measures'][number]['beats']) => string
}

export type BeatSelection = ReturnType<typeof useBeatSelection>

/**
 * Selecting whole beats (across measures) plus copy / cut / paste / clear / delete.
 * Mouse: drag or Shift+click; keyboard: Shift+←/→, ⌘A, Esc; touch: "select" mode then tap two cells.
 */
export function useBeatSelection<C extends Content>(o: Options<C>) {
  const { t } = useTranslation()
  const toast = useToast()
  const clip = useClip()
  const [anchor, setAnchor] = useState<Pos | null>(null)
  const [focus, setFocus] = useState<Pos | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const dragging = useRef(false)
  const valid = (p: Pos | null) => !!p && p.m < o.content.measures.length && p.b < o.content.measures[p.m].beats.length
  const range: [Pos, Pos] | null = anchor && focus && valid(anchor) && valid(focus) ? orderRange(anchor, focus) : null

  useEffect(() => {
    const up = () => (dragging.current = false)
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  const here = (): Pos => ({ m: o.cursor.m, b: o.cursor.b })
  const go = (p: Pos) => o.setCursor({ ...o.cursor, m: p.m, b: p.b })
  const clear = () => {
    setAnchor(null)
    setFocus(null)
  }
  const select = (a: Pos, f: Pos) => {
    setAnchor(a)
    setFocus(f)
  }
  const extendTo = (p: Pos) => {
    setAnchor((a) => a ?? here())
    setFocus(p)
    go(p)
  }

  /** Warns when an edit left bars with the wrong number of beats. */
  const checkFill = (c: C) => {
    const off = c.measures.some((m, i) => !m.free && Math.abs(measureFill(m, tsAt(c, i, o.timeSignature))) > 1)
    if (off) toast(t('select.fixHint'))
  }

  const count = range ? beatsInRange(o.content, range).length : 0

  const copy = (silent = false) => {
    if (!range) return false
    const beats = beatsInRange(o.content, range)
    setClip({ kind: o.kind, beats, ...(isWholeMeasures(o.content, range) ? { measures: measuresInRange(o.content, range) } : {}) })
    if (o.toText) void navigator.clipboard?.writeText(o.toText(beats)).catch(() => {})
    if (!silent) toast(t('select.copied', { count: beats.length }))
    return true
  }

  const cut = () => {
    if (!range || !copy(true)) return
    const next = removeRange(o.content, range, o.timeSignature)
    o.onChange(() => next)
    go(clampPos(next, range[0]))
    clear()
    toast(t('select.cutDone', { count }))
    checkFill(next)
  }

  const clearContent = () => {
    if (!range) return
    o.onChange((c) => clearRange(c, range))
  }

  const deleteBeats = () => {
    if (!range) return
    const next = removeRange(o.content, range, o.timeSignature)
    o.onChange(() => next)
    go(clampPos(next, range[0]))
    clear()
    checkFill(next)
  }

  const paste = (mode: 'insert' | 'overwrite') => {
    const raw = getClip()
    if (!raw) return
    const data = raw.kind === o.kind ? raw : o.adapt(raw)
    if (!data?.beats.length) return toast(t('select.cannotPaste'))
    // Pasting over a selection replaces it.
    let base = o.content
    let at = here()
    if (range) {
      base = mode === 'insert' ? removeRange(base, range, o.timeSignature) : base
      at = mode === 'insert' ? clampPos(base, range[0], true) : range[0]
    }
    let next: C
    let end: Pos
    if (mode === 'overwrite') {
      const r = overwriteAt(base, at, data.beats)
      next = r.content
      end = r.end
    } else if (data.measures && at.b === 0) {
      next = insertMeasuresAt(base, at.m, data.measures)
      end = { m: at.m + data.measures.length - 1, b: data.measures[data.measures.length - 1].beats.length - 1 }
    } else {
      next = insertBeatsAt(base, at, data.beats)
      end = { m: at.m, b: at.b + data.beats.length - 1 }
    }
    o.onChange(() => next)
    select(at, end)
    go(end)
    checkFill(next)
  }

  const onKey = (e: KeyboardEvent): boolean => {
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && k === 'c') return copy(), true
    if (mod && k === 'x') return cut(), true
    if (mod && k === 'v') return paste(e.shiftKey ? 'overwrite' : 'insert'), true
    if (mod && k === 'a') {
      const last = o.content.measures.length - 1
      select({ m: 0, b: 0 }, { m: last, b: o.content.measures[last].beats.length - 1 })
      return true
    }
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const next = stepBeat(o.content, o.cursor, e.key === 'ArrowLeft' ? -1 : 1)
      if (next) extendTo(next)
      return true
    }
    if (range && (e.key === 'Backspace' || e.key === 'Delete')) {
      if (e.shiftKey) deleteBeats()
      else clearContent()
      return true
    }
    if (range && e.key === 'Escape') return clear(), true
    if (range && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key) && !e.shiftKey && !mod) clear()
    return false
  }

  /** Call from a cell's pointerdown before moving the cursor; returns true when the press was a selection gesture. */
  const onCellDown = (p: Pos, e: ReactPointerEvent) => {
    if (e.shiftKey || selectMode) {
      if (selectMode && range) {
        // Third tap in select mode starts a new selection.
        setAnchor(p)
        setFocus(null)
        go(p)
      } else extendTo(p)
      return true
    }
    clear()
    setAnchor(p)
    dragging.current = e.pointerType === 'mouse'
    return false
  }

  const onCellEnter = (p: Pos, e: ReactPointerEvent) => {
    if (!dragging.current || !(e.buttons & 1)) return
    setFocus(p)
    go(p)
  }

  /** Clicking a measure number selects the whole measure (Shift extends by measures). */
  const onMeasureHead = (m: number, e: { shiftKey: boolean }) => {
    const last = o.content.measures[m].beats.length - 1
    if ((e.shiftKey || selectMode) && anchor) {
      const start = comparePos({ m, b: 0 }, anchor) < 0
      const a: Pos = start ? { m: anchor.m, b: o.content.measures[anchor.m].beats.length - 1 } : { m: anchor.m, b: 0 }
      select(a, start ? { m, b: 0 } : { m, b: last })
    } else select({ m, b: 0 }, { m, b: last })
    go({ m, b: 0 })
  }

  return {
    range,
    count,
    clip,
    selectMode,
    setSelectMode,
    isSelected: (m: number, b: number) => !!range && inRange({ m, b }, range),
    copy: () => copy(),
    cut,
    paste,
    clearContent,
    deleteBeats,
    clear,
    onKey,
    onCellDown,
    onCellEnter,
    onMeasureHead,
  }
}

/** A position that exists in `c` (after an edit removed beats), optionally allowing one past the end of a measure. */
function clampPos(c: Content, p: Pos, allowEnd = false): Pos {
  const m = Math.min(p.m, c.measures.length - 1)
  const len = c.measures[m].beats.length
  return { m, b: Math.min(p.b, allowEnd && m === p.m ? len : len - 1) }
}

/** Selection / clipboard toolbar shown under an editor's main toolbar. */
export function SelectionBar({ sel }: { sel: BeatSelection }) {
  const { t } = useTranslation()
  const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  if (!sel.range && !sel.clip && !isTouch && !sel.selectMode) return null
  return (
    <div className={`selection-bar${sel.range ? ' active' : ''}`} role="toolbar" aria-label={t('select.toolbar')}>
      <button className="btn" aria-pressed={sel.selectMode} onClick={() => sel.setSelectMode(!sel.selectMode)} title={t('select.modeHint')}>
        {t('select.mode')}
      </button>
      {sel.range && (
        <>
          <span className="small">{t('select.count', { count: sel.count, from: sel.range[0].m + 1, to: sel.range[1].m + 1 })}</span>
          <button className="btn" onClick={sel.copy} title="⌘C">{t('select.copy')}</button>
          <button className="btn" onClick={sel.cut} title="⌘X">{t('select.cut')}</button>
          <button className="btn" onClick={sel.clearContent} title="Delete">{t('select.clear')}</button>
          <button className="btn" onClick={sel.deleteBeats} title="⇧Delete">{t('select.delete')}</button>
        </>
      )}
      {sel.clip && (
        <>
          <button className="btn" onClick={() => sel.paste('insert')} title="⌘V">{sel.range ? t('select.pasteReplace') : t('select.paste')}</button>
          <button className="btn" onClick={() => sel.paste('overwrite')} title="⇧⌘V">{t('select.pasteOver')}</button>
        </>
      )}
      {sel.range && <button className="btn btn-ghost" onClick={sel.clear} title="Esc">{t('select.cancel')}</button>}
      {!sel.range && sel.selectMode && <span className="muted small">{t('select.modeHint')}</span>}
    </div>
  )
}
