import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { STICKY_COLORS, STICKY_SIZES, type ImageNotes, type Sticky, type StickyColor, type StickySize } from '../music/imageSheet'
import { useNotesDefault, useNotesOpen, type NotesPlace } from '../lib/settings'
import { Icon } from './Icon'

const FIELD: Record<NotesPlace, 'inPdf' | 'inSongbook' | 'searchable'> = { pdf: 'inPdf', songbook: 'inSongbook', search: 'searchable' }
const PLACES: NotesPlace[] = ['pdf', 'songbook', 'search']

/** Whether this sheet's notes show in a place: the sheet's own choice, else the setting. */
export function useNotesShown(notes: ImageNotes, place: NotesPlace) {
  const [def] = useNotesDefault(place)
  return notes[FIELD[place]] ?? def
}

/** What a page needs to place, change and remove stickies. */
export interface StickyEditor {
  /** "Add sticky" was pressed: the next click on a page places one there. */
  placing: boolean
  onPlace: (assetId: string, page: number, x: number, y: number) => void
  onChange: (id: string, change: Partial<Sticky>) => void
  onDelete: (id: string) => void
}

const clamp = (v: number) => Math.min(0.97, Math.max(0, v))

/** A sticky on a page: plain text to read, or (with `edit`) a small note to type in, drag, recolor and resize. */
export function StickyNote({ sticky, edit }: { sticky: Sticky; edit?: StickyEditor }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(sticky.text)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const typing = useRef(false)

  // Someone else changed the text (another tab, undo of a restore): follow it unless typing.
  useEffect(() => {
    if (!typing.current) setText(sticky.text)
  }, [sticky.text])

  // Saved a moment after typing stops, and when leaving the note.
  useEffect(() => {
    if (!edit || text === sticky.text) return
    const id = window.setTimeout(() => edit.onChange(sticky.id, { text }), 400)
    return () => window.clearTimeout(id)
  }, [edit, text, sticky.id, sticky.text])

  // The text box grows with its text.
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text, sticky.size])

  const style = { left: `${(pos ?? sticky).x * 100}%`, top: `${(pos ?? sticky).y * 100}%` } as CSSProperties
  const cls = `sticky sticky-${sticky.color} sticky-${sticky.size}`
  if (!edit) return sticky.text.trim() ? <div className={cls} style={style}>{sticky.text}</div> : null

  const startDrag = (e: PointerEvent<HTMLElement>) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* not a live pointer */
    }
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top }
  }
  const moveDrag = (e: PointerEvent<HTMLElement>) => {
    const page = ref.current?.parentElement?.getBoundingClientRect()
    if (!drag.current || !page) return
    setPos({ x: clamp((e.clientX - drag.current.dx - page.left) / page.width), y: clamp((e.clientY - drag.current.dy - page.top) / page.height) })
  }
  const endDrag = () => {
    drag.current = null
    if (pos) edit.onChange(sticky.id, pos)
    setPos(null)
  }

  return (
    <div
      ref={ref}
      className={`${cls} editing`}
      style={style}
      onBlur={(e) => {
        if (ref.current?.contains(e.relatedTarget as Node)) return
        typing.current = false
        if (!text.trim()) edit.onDelete(sticky.id)
        else if (text !== sticky.text) edit.onChange(sticky.id, { text })
      }}
    >
      <div className="sticky-bar">
        <span className="sticky-grip" title={t('notes.move')} aria-label={t('notes.move')} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>⠿</span>
        <span className="sticky-tools">
          {STICKY_COLORS.map((c) => (
            <button key={c} type="button" className={`sticky-dot sticky-${c}`} aria-pressed={sticky.color === c} aria-label={t(`notes.color.${c}`)} title={t(`notes.color.${c}`)} onClick={() => edit.onChange(sticky.id, { color: c })} />
          ))}
          {STICKY_SIZES.map((z) => (
            <button key={z} type="button" className="sticky-size" aria-pressed={sticky.size === z} title={t(`notes.size.${z}`)} onClick={() => edit.onChange(sticky.id, { size: z })}>{t(`notes.size.${z}`)}</button>
          ))}
          <button type="button" className="sticky-size" aria-label={t('notes.deleteSticky')} title={t('notes.deleteSticky')} onClick={() => edit.onDelete(sticky.id)}>✕</button>
        </span>
      </div>
      <textarea
        ref={textRef}
        rows={1}
        value={text}
        placeholder={t('notes.stickyPlaceholder')}
        autoFocus={!sticky.text}
        onChange={(e) => {
          typing.current = true
          setText(e.target.value)
        }}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
      />
    </div>
  )
}

/** The note text, read-only, above the pages (songbook, PDF). */
export function NotesBlock({ text }: { text: string }) {
  const { t } = useTranslation()
  if (!text.trim()) return null
  return (
    <div className="notes-block">
      <strong>{t('notes.title')}</strong>
      <div>{text}</div>
    </div>
  )
}

/**
 * The notes panel of a picture / PDF sheet, folded away until opened (the last choice is
 * remembered): the note text, saved as you type, adding stickies, and where the notes show.
 */
export function ImageNotesPanel({ notes, onChange, placing, onPlacing, style, onStyle }: {
  notes: ImageNotes
  onChange: (change: Partial<ImageNotes>) => void
  placing: boolean
  onPlacing: (on: boolean) => void
  style: { color: StickyColor; size: StickySize }
  onStyle: (change: Partial<{ color: StickyColor; size: StickySize }>) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useNotesOpen()
  const [text, setText] = useState(notes.text)
  const typing = useRef(false)
  const shown = { pdf: useNotesShown(notes, 'pdf'), songbook: useNotesShown(notes, 'songbook'), search: useNotesShown(notes, 'search') }

  useEffect(() => {
    if (!typing.current) setText(notes.text)
  }, [notes.text])

  useEffect(() => {
    if (text === notes.text) return
    const id = window.setTimeout(() => onChange({ text }), 500)
    return () => window.clearTimeout(id)
  }, [text, notes.text, onChange])

  // Esc stops placing a sticky.
  useEffect(() => {
    if (!placing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onPlacing(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing, onPlacing])

  const summary = [notes.text.trim() && t('notes.hasText'), notes.stickies.length > 0 && t('notes.stickies', { count: notes.stickies.length })].filter(Boolean).join(' · ')

  return (
    <details className="notes-panel" open={open} onToggle={(e) => e.currentTarget.open !== open && setOpen(e.currentTarget.open)}>
      <summary>
        <Icon name="edit" />
        <strong>{t('notes.title')}</strong>
        {summary && <span className="muted small">{summary}</span>}
      </summary>
      <div className="stack" style={{ gap: 10, marginTop: 10 }}>
        <textarea
          className="input notes-text"
          rows={5}
          placeholder={t('notes.placeholder')}
          value={text}
          onChange={(e) => {
            typing.current = true
            setText(e.target.value)
          }}
          onBlur={() => {
            typing.current = false
            if (text !== notes.text) onChange({ text })
          }}
        />
        <div className="row notes-sticky-row">
          <button className={`btn${placing ? ' btn-primary' : ''}`} aria-pressed={placing} onClick={() => onPlacing(!placing)}>
            <Icon name="plus" />
            {placing ? t('notes.placingCancel') : t('notes.addSticky')}
          </button>
          <span className="row" style={{ gap: 4 }} role="group" aria-label={t('notes.colorLabel')}>
            {STICKY_COLORS.map((c) => (
              <button key={c} type="button" className={`sticky-dot sticky-${c}`} aria-pressed={style.color === c} aria-label={t(`notes.color.${c}`)} title={t(`notes.color.${c}`)} onClick={() => onStyle({ color: c })} />
            ))}
          </span>
          <div className="segmented" role="group" aria-label={t('notes.sizeLabel')}>
            {STICKY_SIZES.map((z) => (
              <button key={z} aria-pressed={style.size === z} onClick={() => onStyle({ size: z })}>{t(`notes.size.${z}`)}</button>
            ))}
          </div>
        </div>
        {placing && <p className="muted small" style={{ margin: 0 }}>{t('notes.placingHint')}</p>}
        <div className="row small notes-show">
          <span className="muted">{t('notes.showIn')}</span>
          {PLACES.map((p) => (
            <label key={p} className="row" style={{ gap: 4 }}>
              <input type="checkbox" checked={shown[p]} onChange={(e) => onChange({ [FIELD[p]]: e.target.checked })} />
              {t(`notes.place.${p}`)}
            </label>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('notes.defaultsHint')}</p>
      </div>
    </details>
  )
}

/** Settings: where picture-sheet notes show unless a sheet says otherwise. */
export function NotesSettings() {
  const { t } = useTranslation()
  const pdf = useNotesDefault('pdf')
  const songbook = useNotesDefault('songbook')
  const search = useNotesDefault('search')
  const rows: [NotesPlace, [boolean, (on: boolean) => void]][] = [['pdf', pdf], ['songbook', songbook], ['search', search]]
  return (
    <section className="panel">
      <h2>{t('notes.settingsTitle')}</h2>
      <p className="muted small" style={{ marginTop: -6 }}>{t('notes.settingsHint')}</p>
      <div className="stack" style={{ gap: 8 }}>
        {rows.map(([p, [on, set]]) => (
          <label key={p} className="choice">
            <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
            <span>{t(`notes.settingPlace.${p}`)}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
