// Runs the TAB detector on a canvas (enlarging small screenshots first) and draws what it found.

import { trebleStepName } from './noteHeads'
import { detectTab, enhanceContrast, estimateSkew, toGray, type Detection } from './tabDetect'

/** TAB lines closer than this (px) are enlarged before detecting: digits need some pixels. */
const MIN_SPACING = 22

function scaled(src: HTMLCanvasElement, factor: number) {
  const c = document.createElement('canvas')
  c.width = Math.round(src.width * factor)
  c.height = Math.round(src.height * factor)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

function run(canvas: HTMLCanvasElement): Detection {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return detectTab(toGray(data, canvas.width, canvas.height))
}

/**
 * A scan or photo turned level: the tilt is measured from the staff lines and undone when it is
 * more than a quarter of a degree. Returns the same canvas when it is already level.
 */
export function deskewCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const small = scaled(src, Math.min(1, 900 / src.width))
  const { data } = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height)
  const angle = estimateSkew(toGray(data, small.width, small.height))
  if (Math.abs(angle) < 0.25) return src
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((angle * Math.PI) / 180) // the measured angle is the correction
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return out
}

/** Detection in the canvas's own pixel coordinates. */
export function detectCanvas(src: HTMLCanvasElement): Detection {
  const first = run(scaled(src, Math.min(1, 2400 / Math.max(src.width, src.height))))
  const shrink = Math.min(1, 2400 / Math.max(src.width, src.height))
  const tabs = first.staves.filter((s) => s.kind === 'tab')
  // Only TAB needs enlarging (its digits); staves are found best at the scan's own size.
  const spacing = tabs.length ? Math.min(...tabs.map((s) => s.spacing)) : 0
  // Small print: run again on an enlarged copy (no larger than about 6000 px).
  const grow = spacing && spacing < MIN_SPACING ? Math.min(4, MIN_SPACING / spacing, 6000 / Math.max(src.width, src.height) / shrink) : 1
  const factor = shrink * grow
  const d = grow > 1.2 ? run(scaled(src, factor)) : first
  if (factor === 1) return d
  const k = 1 / factor
  const box = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k })
  return {
    width: src.width,
    height: src.height,
    staves: d.staves.map((s) => ({
      ...s,
      lines: s.lines.map((y) => y * k),
      spacing: s.spacing * k,
      x0: s.x0 * k,
      x1: s.x1 * k,
      barLines: s.barLines.map((x) => x * k),
      columns: s.columns.map((x) => x * k),
      ...(s.tuplets ? { tuplets: s.tuplets.map(([a, b]) => [a * k, b * k] as [number, number]) } : {}),
      numbers: s.numbers.map((n) => ({ ...n, box: box(n.box) })),
      ...(s.heads ? { heads: s.heads.map((hd) => ({ ...hd, x: hd.x * k, y: hd.y * k, box: box(hd.box) })) } : {}),
      ...(s.rests ? { rests: s.rests.map((r) => ({ ...r, x: r.x * k, y: r.y * k, box: box(r.box) })) } : {}),
    })),
  }
}

/**
 * A black-and-white copy with raised contrast, for the AI and the preview: paper pure white, ink
 * pure black, greys pushed further towards black than for measuring (gamma 1.6), so faint lines,
 * thin stems, flags and small digits stand out.
 */
export function enhancedCanvas(src: HTMLCanvasElement, gamma = 1.6): HTMLCanvasElement {
  const out = scaled(src, 1)
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, out.width, out.height)
  const g = enhanceContrast(toGray(img.data, out.width, out.height), gamma)
  for (let i = 0; i < g.data.length; i++) img.data.set([g.data[i], g.data[i], g.data[i], 255], i * 4)
  ctx.putImageData(img, 0, 0)
  return out
}

const STRING_COLORS = ['#e53935', '#fb8c00', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41', '#00897b', '#546e7a']

/** The image with lines, bar lines, numbers (coloured by string) and column numbers drawn over it. */
export function drawDetection(src: HTMLCanvasElement, d: Detection): HTMLCanvasElement {
  const out = scaled(src, 1)
  const ctx = out.getContext('2d')!
  const unit = Math.max(1, Math.round(Math.max(out.width, out.height) / 1200))
  ctx.lineWidth = unit
  let columnNo = 0
  for (const s of d.staves) {
    ctx.strokeStyle = s.kind === 'tab' ? 'rgba(30, 136, 229, 0.8)' : 'rgba(142, 36, 170, 0.5)'
    ctx.setLineDash([4 * unit, 3 * unit])
    for (const y of s.lines) {
      ctx.beginPath()
      ctx.moveTo(s.x0, y)
      ctx.lineTo(s.x1, y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.strokeStyle = '#e53935'
    ctx.lineWidth = 2 * unit
    for (const x of s.barLines) {
      ctx.beginPath()
      ctx.moveTo(x, s.lines[0] - s.spacing)
      ctx.lineTo(x, s.lines[s.lines.length - 1] + s.spacing)
      ctx.stroke()
    }
    ctx.lineWidth = unit
    // Tuplet brackets found in a staff: a green line across the notes they cover.
    if (s.tuplets?.length) {
      ctx.strokeStyle = '#2e7d32'
      ctx.lineWidth = 3 * unit
      for (const [a, b] of s.tuplets) {
        ctx.beginPath()
        ctx.moveTo(a, s.lines[0] - s.spacing * 0.6)
        ctx.lineTo(b, s.lines[0] - s.spacing * 0.6)
        ctx.stroke()
      }
      ctx.lineWidth = unit
    }
    // Note heads found on a staff: a ring (blue filled, orange hollow) with the written pitch.
    if (s.heads?.length) {
      ctx.lineWidth = 2 * unit
      ctx.font = `${Math.max(9, Math.round(s.spacing * 0.75))}px sans-serif`
      ctx.textAlign = 'center'
      for (const hd of s.heads) {
        ctx.strokeStyle = hd.filled ? '#1e88e5' : '#fb8c00'
        ctx.beginPath()
        ctx.ellipse(hd.x, hd.y, s.spacing * 0.75, s.spacing * 0.6, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = hd.filled ? '#1565c0' : '#e65100'
        // Pitch with its accidental, and the value measured (1 whole, 2 half, 4, 8, 16 …; "." per dot).
        const acc = hd.accidental === 'sharp' ? '♯' : hd.accidental === 'flat' ? '♭' : hd.accidental === 'natural' ? '♮' : ''
        const value = !hd.filled ? (hd.stem ? 2 : 1) : 4 * 2 ** (hd.beams ?? 0)
        const below = s.lines[s.lines.length - 1] + s.spacing * (4.6 + (hd.step > 9 ? (hd.step - 9) / 2 : 0))
        ctx.fillText(`${acc}${trebleStepName(hd.step)}`, hd.x, below)
        ctx.fillText(`${value}${'.'.repeat(hd.dots ?? 0)}`, hd.x, below + s.spacing * 0.9)
      }
      ctx.lineWidth = unit
    }
    // Rests: a green box, with the value under the staff ("1休" whole, "2休" half, "4休" quarter, "8休" eighth …).
    if (s.rests?.length) {
      ctx.strokeStyle = '#2e7d32'
      ctx.fillStyle = '#2e7d32'
      ctx.lineWidth = 2 * unit
      ctx.font = `bold ${Math.max(9, Math.round(s.spacing * 0.8))}px sans-serif`
      ctx.textAlign = 'center'
      for (const r of s.rests) {
        ctx.strokeRect(r.box.x0 - 2 * unit, r.box.y0 - 2 * unit, r.box.x1 - r.box.x0 + 4 * unit, r.box.y1 - r.box.y0 + 4 * unit)
        ctx.fillText(`${r.value}休`, r.x, s.lines[s.lines.length - 1] + s.spacing * 3.6)
      }
      ctx.lineWidth = unit
    }
    if (s.kind !== 'tab') continue
    // Arcs (hammer-on / pull-off / tie) and slides found between numbers: magenta.
    ctx.strokeStyle = '#d81b60'
    ctx.lineWidth = 2 * unit
    for (const a of s.numbers) {
      if (!a.link) continue
      const b = s.numbers.find((n) => n.string === a.string && n.column > a.column && !n.stroke)
      if (!b) continue
      const ax = a.box.x1 + unit
      const bx = b.box.x0 - unit
      ctx.beginPath()
      if (a.link === 'slide') {
        ctx.moveTo(ax, a.box.y1)
        ctx.lineTo(bx, b.box.y0)
      } else {
        const top = Math.min(a.box.y0, b.box.y0) - s.spacing * 0.15
        ctx.moveTo(ax, top + s.spacing * 0.2)
        ctx.quadraticCurveTo((ax + bx) / 2, top - s.spacing * 0.4, bx, top + s.spacing * 0.2)
      }
      ctx.stroke()
    }
    ctx.lineWidth = unit
    for (const n of s.numbers) {
      if (n.stroke) continue // slide strokes and arc pieces are not numbers
      // A grace note (small number) gets a dotted box; one whose string could not be confirmed a thick black dashed box.
      ctx.strokeStyle = n.uncertain ? '#000' : STRING_COLORS[(n.string - 1) % STRING_COLORS.length]
      ctx.lineWidth = n.uncertain ? 2 * unit : unit
      ctx.setLineDash(n.uncertain ? [3 * unit, 2 * unit] : n.small ? [unit, 2 * unit] : [])
      ctx.strokeRect(n.box.x0 - 2 * unit, n.box.y0 - 2 * unit, n.box.x1 - n.box.x0 + 4 * unit, n.box.y1 - n.box.y0 + 4 * unit)
    }
    ctx.setLineDash([])
    ctx.lineWidth = unit
    ctx.fillStyle = '#1e88e5'
    ctx.font = `${Math.max(9, Math.round(s.spacing * 0.8))}px sans-serif`
    ctx.textAlign = 'center'
    s.columns.forEach((x) => ctx.fillText(String(++columnNo), x, s.lines[s.lines.length - 1] + s.spacing * 1.8))
    // Rhythm measured under the TAB, in green under the column numbers ("8", "4.", "8³").
    if (s.rhythm) {
      ctx.fillStyle = '#2e7d32'
      s.rhythm.forEach((r, i) => r && ctx.fillText(`${r.duration}${r.dotted ? '.' : ''}${r.triplet ? (r.tuplet === 6 ? '⁶' : '³') : ''}`, s.columns[i], s.lines[s.lines.length - 1] + s.spacing * 2.8))
    }
  }
  return out
}
