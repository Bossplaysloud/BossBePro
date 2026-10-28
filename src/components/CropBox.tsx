import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { CropRect } from '../lib/image'

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'
const MIN = 0.05

/** Shows a canvas and a draggable crop rectangle over it (normalized coordinates). */
export function CropBox({ source, crop, onChange }: { source: HTMLCanvasElement; crop: CropRect; onChange: (c: CropRect) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ handle: Handle; startX: number; startY: number; start: CropRect } | null>(null)

  // A downscaled preview keeps dragging smooth on large photos.
  const url = useMemo(() => {
    const scale = Math.min(1, 1400 / Math.max(source.width, source.height))
    const c = document.createElement('canvas')
    c.width = Math.round(source.width * scale)
    c.height = Math.round(source.height * scale)
    c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  }, [source])

  const begin = (handle: Handle) => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: crop }
  }

  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    const box = wrapRef.current?.getBoundingClientRect()
    if (!d || !box) return
    const dx = (e.clientX - d.startX) / box.width
    const dy = (e.clientY - d.startY) / box.height
    let { x, y, w, h } = d.start
    if (d.handle === 'move') {
      x = Math.min(1 - w, Math.max(0, x + dx))
      y = Math.min(1 - h, Math.max(0, y + dy))
    } else {
      let x2 = x + w
      let y2 = y + h
      if (d.handle.includes('w')) x = Math.min(x2 - MIN, Math.max(0, x + dx))
      if (d.handle.includes('e')) x2 = Math.max(x + MIN, Math.min(1, x2 + dx))
      if (d.handle.includes('n')) y = Math.min(y2 - MIN, Math.max(0, y + dy))
      if (d.handle.includes('s')) y2 = Math.max(y + MIN, Math.min(1, y2 + dy))
      w = x2 - x
      h = y2 - y
    }
    onChange({ x, y, w, h })
  }

  const end = () => (drag.current = null)

  return (
    <div ref={wrapRef} className="crop-wrap" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {url && <img src={url} alt="" draggable={false} />}
      <div
        className="crop-rect"
        style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
        onPointerDown={begin('move')}
      >
        {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
          <span key={h} className={`crop-handle ${h}`} onPointerDown={begin(h)} />
        ))}
      </div>
    </div>
  )
}
