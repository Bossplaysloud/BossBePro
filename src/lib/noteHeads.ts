// Finds note heads on a five-line staff without AI, and the pitch each one is written at.
//
// Method (as in optical music recognition):
// - Staff lines and ledger lines are erased: on a line row, ink whose vertical run is no taller
//   than the line belongs to the line (a head on the line keeps its pixels, its run is taller).
// - Filled heads: an ellipse about one space tall is the only thick ink on a staff. Stems, bar
//   lines, ledger lines, flags, accidentals, clefs and digits are thin; beams are half a space
//   thick. So a pixel more than a third of a space from any white pixel lies inside a head.
// - Hollow heads (half and whole notes): a small white hole closed all round by a thin ring. Holes
//   of flats, naturals, sharps and digits are told apart by the strokes running past them: a head
//   has at most its stem, going up on the right or down on the left.
// - Above or below the staff, a head needs its ledger lines (chord symbols and numbers have none).
// - The pitch is the line or space of the head's centre: half-spacing steps from the top line.

import type { Gray, Staff } from './tabDetect'

const INK_DARK = 170

export interface NoteHead {
  /** Centre of the head. */
  x: number
  y: number
  /** Half-spacing steps below the top line: 0 = top line, 1 = top space, 8 = bottom line, −2 = first ledger line above. */
  step: number
  filled: boolean
  box: { x0: number; y0: number; x1: number; y1: number }
  /** The stem: its side of the head, its x and the y where it ends; none for a whole note. */
  stem?: { dir: 'up' | 'down'; x: number; end: number }
  /** Beams or flags at the stem's end: 0 quarter / half, 1 eighth, 2 sixteenth, 3 thirty-second. */
  beams?: number
  /** Augmentation dots after the head. */
  dots?: number
  /** An accidental printed just before the head. */
  accidental?: 'sharp' | 'flat' | 'natural'
}

export interface StaffAccidental {
  x: number
  y: number
  type: 'sharp' | 'flat' | 'natural'
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** Written pitch of a step in the treble clef: step 0 (top line) is F5. */
export function trebleStepName(step: number) {
  const d = 38 - step // diatonic index, octave × 7 + letter (F5 = 5 × 7 + 3)
  return `${LETTERS[((d % 7) + 7) % 7]}${Math.floor(d / 7)}`
}

/** Fractional half-spacing steps below the top line at height y, following the measured lines. */
function stepAt(lines: number[], spacing: number, y: number) {
  const n = lines.length
  if (y <= lines[0]) return ((y - lines[0]) / spacing) * 2
  if (y >= lines[n - 1]) return (n - 1) * 2 + ((y - lines[n - 1]) / spacing) * 2
  for (let i = 0; i < n - 1; i++) if (y <= lines[i + 1]) return i * 2 + ((y - lines[i]) / (lines[i + 1] - lines[i])) * 2
  return (n - 1) * 2
}

export interface StaffRest {
  /** Centre of the rest. */
  x: number
  y: number
  /** 1 = whole, 2 = half, 4 = quarter, 8, 16, 32 = eighth and shorter (by the number of flags). */
  value: 1 | 2 | 4 | 8 | 16 | 32
  box: { x0: number; y0: number; x1: number; y1: number }
}

/** Note heads and rests on a five-line staff. */
export function findStaffSymbols(g: Gray, staff: Staff): { heads: NoteHead[]; rests: StaffRest[]; accidentals: StaffAccidental[]; keySignature: number } {
  const none = { heads: [], rests: [], accidentals: [], keySignature: 0 }
  if (staff.kind !== 'staff' || staff.lines.length !== 5) return none
  const sp = staff.spacing
  const lines = staff.lines
  const top = lines[0]
  const bottom = lines[4]
  // Room for three ledger lines above and below.
  const rx0 = Math.max(0, Math.floor(staff.x0))
  const rx1 = Math.min(g.width - 1, Math.ceil(staff.x1))
  const ry0 = Math.max(0, Math.floor(top - sp * 4))
  const ry1 = Math.min(g.height - 1, Math.ceil(bottom + sp * 4))
  const w = rx1 - rx0 + 1
  const h = ry1 - ry0 + 1
  if (w < sp * 4 || h < sp * 4) return none
  const ink = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ink[y * w + x] = g.data[(ry0 + y) * g.width + rx0 + x] < INK_DARK ? 1 : 0
  const raw = ink.slice()
  const at = (b: Uint8Array, x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && b[y * w + x] === 1

  // Erase staff lines and ledger-line positions (ledger lines only exist where they are drawn).
  // Only runs as thin as a line are erased: where the edge of a head touches a line the run is
  // taller, and the edge must stay (or a whole note's hole leaks out). Line thickness: the usual
  // vertical run on the lines.
  const lineThickness = (b: Uint8Array) => {
    const runs: number[] = []
    for (const ly of lines) {
      const r = Math.round(ly) - ry0
      for (let x = 0; x < w; x += 3) {
        if (!b[r * w + x]) continue
        let up = r
        while (up > 0 && b[(up - 1) * w + x]) up--
        let down = r
        while (down < h - 1 && b[(down + 1) * w + x]) down++
        runs.push(down - up + 1)
      }
    }
    runs.sort((a, c) => a - c)
    const usual = runs.length ? runs[Math.floor(runs.length / 2)] : 2
    return Math.min(Math.max(2, Math.round(sp * 0.22)), usual + 1)
  }
  const lineYs = [...lines]
  for (let k = 1; k <= 3; k++) lineYs.push(top - sp * k, bottom + sp * k)
  const near = Math.max(1, Math.round(sp * 0.1))
  const eraseLines = (b: Uint8Array) => {
    const thick = lineThickness(b)
    for (const ly of lineYs) {
      const cy = Math.round(ly) - ry0
      for (let x = 0; x < w; x++) {
        // Only runs through the line itself (a short run near it may be the edge of a head's ring).
        for (let d = -near; d <= near; d++) {
          const r = cy + d
          if (r < 0 || r >= h || !b[r * w + x]) continue
          let up = r
          while (up > 0 && b[(up - 1) * w + x]) up--
          let down = r
          while (down < h - 1 && b[(down + 1) * w + x]) down++
          if (down - up + 1 <= thick) for (let y = up; y <= down; y++) b[y * w + x] = 0
        }
      }
    }
  }
  eraseLines(ink)
  // For closed holes, faint ink counts too: the thin top and bottom of a whole note's ring is
  // often only grey, and the hole must not leak out through it.
  const wall = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) wall[y * w + x] = g.data[(ry0 + y) * g.width + rx0 + x] < 215 ? 1 : 0
  // (kept with its lines: holes are found on it, and the thin grey strokes of accidentals followed)
  const faint = wall

  const heads: NoteHead[] = []

  // ----- filled heads: distance to the nearest white pixel (chamfer 1 / 1.4) -----
  const dist = new Float32Array(w * h)
  const BIG = 1e6
  for (let i = 0; i < w * h; i++) dist[i] = ink[i] ? BIG : 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!dist[i]) continue
      let v = dist[i]
      v = Math.min(v, (x > 0 ? dist[i - 1] : 0) + 1, (y > 0 ? dist[i - w] : 0) + 1, (x > 0 && y > 0 ? dist[i - w - 1] : 0) + 1.4, (x < w - 1 && y > 0 ? dist[i - w + 1] : 0) + 1.4)
      dist[i] = v
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!dist[i]) continue
      dist[i] = Math.min(dist[i], (x < w - 1 ? dist[i + 1] : 0) + 1, (y < h - 1 ? dist[i + w] : 0) + 1, (x < w - 1 && y < h - 1 ? dist[i + w + 1] : 0) + 1.4, (x > 0 && y < h - 1 ? dist[i + w - 1] : 0) + 1.4)
    }
  const core = Math.max(2, sp * 0.3)
  const cores: { cx: number; cy: number; box: { x0: number; y0: number; x1: number; y1: number } }[] = []
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  for (let i = 0; i < w * h; i++) {
    if (dist[i] < core || seen[i]) continue
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1
    let sx = 0
    let sy = 0
    let n = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length) {
      const k = stack.pop()!
      const x = k % w
      const y = (k - x) / w
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
      sx += x
      sy += y
      n++
      for (const nb of [k - 1, k + 1, k - w, k + w]) {
        if (nb < 0 || nb >= w * h || seen[nb] || dist[nb] < core) continue
        if (Math.abs((nb % w) - x) > 1) continue
        seen[nb] = 1
        stack.push(nb)
      }
    }
    // A core much wider than a head is a thick beam or a block, not a head.
    if (x1 - x0 > sp * 1.2) continue
    // Heads stacked in a chord can join: split a tall core into heads one space apart.
    const parts = Math.max(1, Math.round((y1 - y0 + 1) / (sp * 0.9)))
    for (let p = 0; p < parts; p++) {
      const cx = parts === 1 ? sx / n : (x0 + x1) / 2
      const cy = parts === 1 ? sy / n : y0 + ((p + 0.5) * (y1 - y0 + 1)) / parts
      const box = extent(ink, w, h, Math.round(cx), Math.round(cy), sp)
      // Not a beam: a head is at most about two spaces wide (a second's neighbour may touch it).
      if (box.x1 - box.x0 > sp * 2.4) continue
      cores.push({ cx, cy, box })
    }
  }

  // A filled head always has a stem (quarter notes and shorter): a straight thin line going up
  // from its right side or down from its left side, about three spaces long. Rests, clef curls,
  // flats, sharps, naturals and digits have no such line.
  const vrun = (x: number, y: number, dir: -1 | 1) => {
    let len = 0
    let gap = 0
    for (let yy = y; yy >= 0 && yy < h && gap <= 1; yy += dir) {
      if (at(raw, x, yy)) {
        gap = 0
        len = Math.abs(yy - y)
      } else gap++
    }
    return len
  }
  // A stem is thin all along: past the head, nearly every row of it is a narrow run of ink, or a
  // beam (a rest's zigzag or a clef's curl is wide in places, and not long).
  const thinAlong = (x: number, cy: number, len: number, dir: -1 | 1) => {
    let rows = 0
    let thin = 0
    for (let d = Math.round(sp * 0.7); d <= len; d++) {
      const y = Math.round(cy) + d * dir
      if (!at(raw, x, y)) continue
      rows++
      let a = x
      while (a > x - sp && at(ink, a - 1, y)) a--
      let b = x
      while (b < x + sp && at(ink, b + 1, y)) b++
      // (a beam crossing the stem is wide too, but long: it runs on to the next stem)
      if (b - a + 1 <= Math.max(3, sp * 0.42) || b - a + 1 >= sp * 1.5) thin++
    }
    return rows > 0 && thin >= rows * 0.75
  }
  const stemOf = (cx: number, cy: number, min = sp * 2.2): NoteHead['stem'] | null => {
    const best = (from: number, to: number, dir: -1 | 1) => {
      let len = 0
      let at = 0
      for (let x = Math.round(from); x <= Math.round(to); x++) {
        const l = vrun(x, Math.round(cy), dir)
        if (l > len) {
          len = l
          at = x
        }
      }
      return len >= min && thinAlong(at, cy, len, dir) ? { x: at, end: Math.round(cy) + dir * len } : null
    }
    const up = best(cx + sp * 0.2, cx + sp * 0.95, -1)
    if (up) return { dir: 'up', x: up.x + rx0, end: up.end + ry0 }
    const down = best(cx - sp * 0.95, cx - sp * 0.2, 1)
    return down ? { dir: 'down', x: down.x + rx0, end: down.end + ry0 } : null
  }
  const stemless: typeof cores = []
  for (const c of cores) {
    const stem = stemOf(c.cx, c.cy)
    if (stem) heads.push({ x: c.cx + rx0, y: c.cy + ry0, step: 0, filled: true, stem, box: { x0: c.box.x0 + rx0, y0: c.box.y0 + ry0, x1: c.box.x1 + rx0, y1: c.box.y1 + ry0 } })
    else stemless.push(c)
  }
  // In a small or blurred print the ring of a whole or half note can be thick enough to leave a
  // core on each side: two stemless cores side by side at one height, light between them.
  for (let i = 0; i < stemless.length; i++)
    for (let j = i + 1; j < stemless.length; j++) {
      const a = stemless[i]
      const b = stemless[j]
      const dx = Math.abs(a.cx - b.cx)
      if (Math.abs(a.cy - b.cy) > sp * 0.3 || dx < sp * 0.3 || dx > sp * 1.1) continue
      const mx = (a.cx + b.cx) / 2
      const my = (a.cy + b.cy) / 2
      if (g.data[(Math.round(my) + ry0) * g.width + Math.round(mx) + rx0] < INK_DARK) continue
      const box = { x0: Math.min(a.box.x0, b.box.x0), y0: Math.min(a.box.y0, b.box.y0), x1: Math.max(a.box.x1, b.box.x1), y1: Math.max(a.box.y1, b.box.y1) }
      heads.push({ x: mx + rx0, y: my + ry0, step: 0, filled: false, box: { x0: box.x0 + rx0, y0: box.y0 + ry0, x1: box.x1 + rx0, y1: box.y1 + ry0 } })
    }

  // ----- hollow heads: closed white holes -----
  // Found with the lines kept: a head in a space touches both lines with its thin top and bottom,
  // so erasing them would open the hole. A head on a line has its hole cut in two by the line:
  // the two halves, one above the other with only the line between, are joined again.
  const accidentals: StaffAccidental[] = []
  const white = new Uint8Array(w * h)
  const holes: { x0: number; y0: number; x1: number; y1: number; n: number }[] = []
  for (let i = 0; i < w * h; i++) {
    if (wall[i] || white[i]) continue
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1
    let n = 0
    let open = false
    stack.push(i)
    white[i] = 1
    while (stack.length) {
      const k = stack.pop()!
      const x = k % w
      const y = (k - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) open = true
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
      n++
      if (n > sp * sp * 2) open = true
      for (const nb of [k - 1, k + 1, k - w, k + w]) {
        if (nb < 0 || nb >= w * h || white[nb] || wall[nb]) continue
        if (Math.abs((nb % w) - x) > 1) continue
        white[nb] = 1
        stack.push(nb)
      }
    }
    if (open || x1 - x0 + 1 < sp * 0.2 || y1 - y0 + 1 < 2) continue
    holes.push({ x0, y0, x1, y1, n })
  }
  holes.sort((p, q) => p.y0 - q.y0)
  for (let i = 0; i < holes.length; i++)
    for (let j = i + 1; j < holes.length; j++) {
      const p = holes[i]
      const q = holes[j]
      if (!p.n || !q.n) continue
      const gap = q.y0 - p.y1 - 1
      const midY = (p.y1 + q.y0) / 2 + ry0
      const onLine = lineYs.some((ly) => Math.abs(ly - midY) <= sp * 0.2)
      if (gap < 1 || gap > Math.max(3, sp * 0.25) || !onLine || Math.abs((p.x0 + p.x1) / 2 - (q.x0 + q.x1) / 2) > sp * 0.35) continue
      holes[i] = { x0: Math.min(p.x0, q.x0), y0: p.y0, x1: Math.max(p.x1, q.x1), y1: q.y1, n: p.n + q.n }
      q.n = 0
    }
  for (const { x0, y0, x1, y1, n } of holes) {
    if (!n) continue
    const hw = x1 - x0 + 1
    const hh = y1 - y0 + 1
    if (hw > sp * 1.3 || hh < sp * 0.12 || hh > sp * 1.0 || n > sp * sp * 0.9) continue
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    // The ring around the hole: how far the ink goes on from the hole's edge.
    const ringRun = (x: number, y: number, dx: number, dy: number) => {
      let t = 0
      while (at(wall, Math.round(x), Math.round(y)) && t <= sp * 0.8) {
        x += dx
        y += dy
        t += Math.hypot(dx, dy)
      }
      return t
    }
    // Rows and columns through the middle of the hole (or of its halves, beside the line).
    const rowY = Math.round(lineYs.some((ly) => Math.abs(ly - ry0 - cy) <= sp * 0.2) ? y0 + Math.max(1, (y1 - y0) * 0.2) : cy)
    let ha = Math.round(cx)
    while (ha > x0 - 1 && !at(wall, ha - 1, rowY)) ha--
    let hb = Math.round(cx)
    while (hb < x1 + 1 && !at(wall, hb + 1, rowY)) hb++
    const left = ringRun(ha - 1, rowY, -1, 0)
    const right = ringRun(hb + 1, rowY, 1, 0)
    const up = ringRun(Math.round(cx), y0 - 1, 0, -1)
    const down = ringRun(Math.round(cx), y1 + 1, 0, 1)
    // Thin all round: an outline, not a hole in a big shape.
    if ([left, right, up, down].filter((t) => t > 0 && t <= sp * 0.7).length < 4) continue
    // Strokes running past the hole: flats, naturals and sharps have one going up on the left,
    // digits like 4 have one going both ways; a head only its stem (up on the right, down on the left).
    const run = (side: -1 | 1, dir: -1 | 1) => {
      let best = 0
      const xs = side < 0 ? [x0 - 1, x0 - 2, x0 - 3, x0 - 4] : [x1 + 1, x1 + 2, x1 + 3, x1 + 4]
      for (const x of xs) {
        let y = dir < 0 ? y0 : y1
        let len = 0
        let gap = 0
        while (y >= 0 && y < h && gap <= 1) {
          if (at(faint, x, y) && !lineYs.some((ly) => Math.abs(ly - ry0 - y) <= 1.5)) {
            gap = 0
            len = Math.abs(y - (dir < 0 ? y0 : y1))
          } else if (!lineYs.some((ly) => Math.abs(ly - ry0 - y) <= 1.5)) gap++
          y += dir
        }
        best = Math.max(best, len)
      }
      return best
    }
    const runs = { lu: run(-1, -1), ld: run(-1, 1), ru: run(1, -1), rd: run(1, 1) }
    const long = sp * 1.2
    const leftUp = runs.lu > long
    const leftDown = runs.ld > long
    const rightUp = runs.ru > long
    const rightDown = runs.rd > long
    // Holes with strokes past them (shorter ones count here): ♯ (up and down on both sides),
    // ♮ (up on the left, down on the right), ♭ (up on the left only).
    const some = sp * 0.7
    const [lu, ld, ru, rd] = [runs.lu > some, runs.ld > some, runs.ru > some, runs.rd > some]
    const type = lu && ld && ru && rd ? 'sharp' : lu && rd && !ru ? 'natural' : runs.lu > long && !ru && !rd ? 'flat' : null
    if (type && hw <= sp * 0.9) {
      accidentals.push({ x: cx + rx0, y: cy + ry0, type })
      continue
    }
    if (leftUp || rightDown || (leftDown && rightUp)) continue
    const box = { x0: ha - left, x1: hb + right, y0: y0 - up, y1: y1 + down }
    // A head is wider than tall (a natural's box is narrow and tall).
    if (box.x1 - box.x0 < sp * 0.85 || box.y1 - box.y0 < sp * 0.5 || box.y1 - box.y0 > sp * 1.25) continue
    heads.push({ x: (box.x0 + box.x1) / 2 + rx0, y: cy + ry0, step: 0, filled: false, box: { x0: box.x0 + rx0, y0: box.y0 + ry0, x1: box.x1 + rx0, y1: box.y1 + ry0 } })
  }

  // The time signature stands before the first note (a rest can fill the staff the same way).
  const header = headerRanges(ink, w, h, top - ry0, bottom - ry0, sp)
  const clef = header.clef ? [header.clef[0] + rx0, header.clef[1] + rx0] : null
  const firstHead = Math.min(...heads.filter((hd) => !clef || hd.x < clef[0] || hd.x > clef[1]).map((hd) => hd.x), Infinity)
  // (only the first such shape: a rest after it can fill the staff in the same way)
  const skip = [...(clef ? [clef] : []), ...header.times.map(([a, b]) => [a + rx0, b + rx0]).filter(([a]) => a < firstHead).slice(0, 1)]

  // ----- pitch, and ledger lines for heads off the staff -----
  const ledgerAt = (ly: number, hx0: number, hx1: number) => {
    const y = Math.round(ly) - ry0
    const reach = Math.max(2, Math.round(sp * 0.15))
    for (let d = -1; d <= 1; d++) {
      const r = y + d
      if (r < 0 || r >= h) continue
      // Ink on the row just beyond both sides of the head: a ledger line sticks out of it.
      const left = [1, 2].some((k) => at(raw, Math.round(hx0 - rx0) - reach + k - 1, r))
      const right = [1, 2].some((k) => at(raw, Math.round(hx1 - rx0) + reach - k + 1, r))
      if (left && right) return true
    }
    return false
  }
  const out: NoteHead[] = []
  for (const hd of heads) {
    if (skip.some(([a, b]) => hd.x >= a && hd.x <= b)) continue
    const step = Math.round(stepAt(lines, sp, hd.y))
    hd.step = step
    if (step < -1) {
      // Every ledger line from the staff out to the head must be there.
      let ok = true
      for (let s = -2; s >= step; s -= 2) if (!ledgerAt(top + (s / 2) * sp, hd.box.x0, hd.box.x1)) ok = false
      if (!ok) continue
    } else if (step > 9) {
      let ok = true
      for (let s = 10; s <= step; s += 2) if (!ledgerAt(bottom + ((s - 8) / 2) * sp, hd.box.x0, hd.box.x1)) ok = false
      if (!ok) continue
    }
    if (step < -7 || step > 15) continue
    // The same head found twice (a filled head with a speck of white inside).
    if (out.some((o) => Math.abs(o.x - hd.x) < sp * 0.5 && Math.abs(o.y - hd.y) < sp * 0.4)) continue
    out.push(hd)
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y)

  // ----- rhythm marks of each head: stem, beams or flags, dots; and its accidental -----
  for (const hd of out) {
    const lx = hd.x - rx0
    const ly = hd.y - ry0
    if (!hd.filled) hd.stem = stemOf(lx, ly, sp * 2.0) ?? undefined
    hd.beams = hd.stem ? beamsAt(hd.stem.x - rx0, hd.stem.end - ry0, hd.stem.dir, ly) : 0
    hd.dots = dotsAfter(hd.box.x1 - rx0, ly, hd.step)
  }
  // Heads sharing a stem (a chord) share its beams: the count is taken from the end head.
  for (const hd of out) {
    if (!hd.stem) continue
    const mates = out.filter((o) => o.stem && Math.abs(o.stem.x - hd.stem!.x) <= 2)
    const most = Math.max(...mates.map((o) => o.beams ?? 0))
    for (const o of mates) o.beams = most
  }
  // Key signature: the accidentals before the first note (after the clef); the rest belong to
  // the head just right of them, at the same height.
  const firstX = out.length ? out[0].x : Infinity
  const keyAcc = accidentals.filter((a) => a.x < firstX - sp * 1.6 && (!clef || a.x > clef[1]))
  const keyType = keyAcc.length && keyAcc.every((a) => a.type === keyAcc[0].type) && keyAcc[0].type !== 'natural' ? keyAcc[0].type : null
  const keySignature = keyType ? (keyType === 'sharp' ? 1 : -1) * keyAcc.length : 0
  for (const a of accidentals) {
    if (keyAcc.includes(a)) continue
    const target = out.find((hd) => hd.x - a.x >= sp * 0.5 && hd.x - a.x <= sp * 2.3 && Math.abs(hd.y - a.y) <= sp * 0.4)
    if (target) target.accidental = a.type
  }
  // Bar lines (and anything before the first) are no rests.
  const bars = staff.barLines
  const restSkip = [...skip, ...bars.map((b) => [b - sp * 0.3, b + sp * 0.3]), ...(bars.length ? [[-Infinity, bars[0] + sp * 0.3]] : [])]
  const rests = findRests(ink, w, h, rx0, ry0, lines, sp, out, restSkip)
  return { heads: out, rests, accidentals, keySignature }

  /**
   * Beams or flags at the far end of a stem: separate thick runs of ink met going from the end
   * back towards the head, half a space beside the stem (beams run on to the next stem on either
   * side, flags go out to the right).
   */
  function beamsAt(sx: number, end: number, dir: 'up' | 'down', headY: number) {
    const back = dir === 'up' ? 1 : -1
    const limit = Math.abs(headY - end) - sp * 1.0
    let best = 0
    for (const off of [-0.55, 0.55, 0.9]) {
      const x = Math.round(sx + off * sp)
      if (x < 0 || x >= w) continue
      let count = 0
      let run = 0
      for (let d = -Math.round(sp * 0.3); d <= limit; d++) {
        const y = Math.round(end + back * d)
        if (at(ink, x, y)) run++
        else {
          if (run >= Math.max(2, sp * 0.2)) count++
          run = 0
        }
      }
      if (run >= Math.max(2, sp * 0.2)) count++
      best = Math.max(best, count)
    }
    return Math.min(3, best)
  }

  /** Augmentation dots: small round blobs right of the head, in the space at (or above) its height. */
  function dotsAfter(right: number, headY: number, step: number) {
    // A head on a line has its dot in the space above.
    const dy = step % 2 === 0 ? Math.round(headY - sp * 0.5) : Math.round(headY)
    let x = Math.round(right + sp * 0.15)
    let dots = 0
    const stop = right + sp * 1.6
    while (x < stop && x < w && dots < 2) {
      if (!at(ink, x, dy) && !at(ink, x, dy - 1) && !at(ink, x, dy + 1)) {
        x++
        continue
      }
      // Measure the blob around (x, dy).
      let x0b = x
      let x1b = x
      while (x1b + 1 < w && [dy - 1, dy, dy + 1].some((yy) => at(ink, x1b + 1, yy))) x1b++
      let y0b = dy
      let y1b = dy
      const mid = Math.round((x0b + x1b) / 2)
      while (y0b > 0 && at(ink, mid, y0b - 1)) y0b--
      while (y1b < h - 1 && at(ink, mid, y1b + 1)) y1b++
      const bw = x1b - x0b + 1
      const bh = y1b - y0b + 1
      if (bw >= sp * 0.2 && bw <= sp * 0.6 && bh >= sp * 0.2 && bh <= sp * 0.6) dots++
      else if (bw <= sp * 0.35 && bh > sp * 0.8) {
        // the head's own stem (or a bar line): look past it
        x = x1b + 1
        continue
      } else break
      x = x1b + Math.max(2, Math.round(sp * 0.15))
    }
    return dots
  }
}

/**
 * Rests, from the ink with the lines erased, as shapes inside the staff that hold no note head:
 * - a solid block about a space wide and half a space tall: hanging from a line, a whole rest;
 *   sitting on a line, a half rest;
 * - a tall shape (about three spaces) with no hole and no straight stem: a quarter rest when it
 *   zigzags, an eighth or shorter when it is one slanted stroke with blobs (flags) on its left,
 *   one blob per flag. (Accidentals have holes; the clef and time signature are skipped.)
 */
function findRests(ink: Uint8Array, w: number, h: number, rx0: number, ry0: number, lines: number[], sp: number, heads: NoteHead[], skip: number[][]): StaffRest[] {
  const top = lines[0] - ry0
  const bottom = lines[4] - ry0
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const rests: StaffRest[] = []
  const y0band = Math.max(0, Math.round(top - sp * 0.6))
  const y1band = Math.min(h - 1, Math.round(bottom + sp * 0.6))
  for (let sy = y0band; sy <= y1band; sy++)
    for (let sx = 0; sx < w; sx++) {
      const i0 = sy * w + sx
      if (!ink[i0] || seen[i0]) continue
      const pixels: number[] = []
      let x0 = w
      let y0 = h
      let x1 = -1
      let y1 = -1
      stack.push(i0)
      seen[i0] = 1
      while (stack.length) {
        const k = stack.pop()!
        const x = k % w
        const y = (k - x) / w
        pixels.push(k)
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const nb = ny * w + nx
            if (!ink[nb] || seen[nb]) continue
            seen[nb] = 1
            stack.push(nb)
          }
      }
      const bw = (x1 - x0 + 1) / sp
      const bh = (y1 - y0 + 1) / sp
      if (y0 < top - sp * 1.2 || y1 > bottom + sp * 1.2) continue
      const gx0 = x0 + rx0
      const gx1 = x1 + rx0
      if (skip.some(([a, b]) => gx1 >= a && gx0 <= b)) continue
      if (heads.some((hd) => hd.x >= gx0 - sp * 0.3 && hd.x <= gx1 + sp * 0.3 && hd.y >= y0 + ry0 - sp * 0.3 && hd.y <= y1 + ry0 + sp * 0.3)) continue
      const box = { x0: gx0, y0: y0 + ry0, x1: gx1, y1: y1 + ry0 }
      const cx = (x0 + x1) / 2 + rx0
      const cy = (y0 + y1) / 2 + ry0
      // Solid block: whole or half rest.
      if (bw >= 0.7 && bw <= 1.8 && bh >= 0.25 && bh <= 0.8 && pixels.length >= (x1 - x0 + 1) * (y1 - y0 + 1) * 0.7) {
        const nearLine = (y: number) => lines.some((ly) => Math.abs(ly - ry0 - y) <= sp * 0.25)
        const hangs = nearLine(y0)
        const sits = nearLine(y1)
        if (hangs === sits) {
          // Both or neither: the usual places, whole under the 4th line, half on the middle line.
          const whole = Math.abs(y0 - (lines[1] - ry0)) <= Math.abs(y1 - (lines[2] - ry0))
          rests.push({ x: cx, y: cy, value: whole ? 1 : 2, box })
        } else rests.push({ x: cx, y: cy, value: hangs ? 1 : 2, box })
        continue
      }
      // Tall shapes: quarter, eighth and shorter rests.
      // (a quarter rest is about three spaces tall; a shape as tall as the staff is a bar line)
      if (bh < 1.3 || bh > 3.5 || bw < 0.35 || bw > 1.4) continue
      // Inside the staff (a rest is centred on it, roughly).
      if (cy - ry0 < top + sp * 0.5 || cy - ry0 > bottom - sp * 0.5) continue
      const mask = new Uint8Array((x1 - x0 + 3) * (y1 - y0 + 3))
      const mw = x1 - x0 + 3
      for (const k of pixels) mask[((k - (k % w)) / w - y0 + 1) * mw + (k % w) - x0 + 1] = 1
      if (hasHole(mask, mw, y1 - y0 + 3)) continue
      // A straight thin vertical line (stem, bar line, letter stroke) rules it out.
      // (counting only rows where the ink there is narrow: a rest's thick middle is no line)
      const narrowAt = (x: number, y: number) => {
        let a = x
        while (a > x0 && ink[y * w + a - 1]) a--
        let b = x
        while (b < x1 && ink[y * w + b + 1]) b++
        return b - a + 1 <= Math.max(3, sp * 0.3)
      }
      let straight = 0
      for (let x = x0; x <= x1; x++) {
        let run = 0
        for (let y = y0; y <= y1; y++) {
          run = ink[y * w + x] && narrowAt(x, y) ? run + 1 : 0
          straight = Math.max(straight, run)
        }
      }
      if (straight >= sp * 1.6) continue
      // Per row: leftmost and rightmost ink.
      const left: number[] = []
      const right: number[] = []
      for (let y = y0; y <= y1; y++) {
        let a = -1
        let b = -1
        for (let x = x0; x <= x1; x++)
          if (ink[y * w + x]) {
            if (a < 0) a = x
            b = x
          }
        left.push(a)
        right.push(b)
      }
      // Eighth-type: the right edge runs down to the left in a straight slant over the shape.
      const ys: number[] = []
      const rs: number[] = []
      right.forEach((r, k) => r >= 0 && (ys.push(k), rs.push(r)))
      const n = ys.length
      const my = ys.reduce((a, b) => a + b, 0) / n
      const mr = rs.reduce((a, b) => a + b, 0) / n
      let sxy = 0
      let syy = 0
      ys.forEach((y, k) => {
        sxy += (y - my) * (rs[k] - mr)
        syy += (y - my) ** 2
      })
      const slope = syy ? sxy / syy : 0
      let res = 0
      ys.forEach((y, k) => (res += (rs[k] - (mr + slope * (y - my))) ** 2))
      const straightSlant = slope < -0.12 && slope > -0.8 && Math.sqrt(res / n) < sp * 0.12
      if (straightSlant) {
        // Flags: runs of rows where the ink reaches well left of the stroke.
        let flags = 0
        let inBlob = false
        right.forEach((r, k) => {
          const blob = r >= 0 && left[k] >= 0 && r - left[k] > sp * 0.45
          if (blob && !inBlob) flags++
          inBlob = blob
        })
        flags = Math.max(1, Math.min(3, flags))
        rests.push({ x: cx, y: cy, value: (4 * 2 ** flags) as 8 | 16 | 32, box })
      } else if (bh >= 2) rests.push({ x: cx, y: cy, value: 4, box })
    }
  return rests.sort((a, b) => a.x - b.x)
}

/** Whether a shape (mask with a one-pixel empty border) encloses white. */
function hasHole(mask: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(w * h)
  const stack = [0]
  out[0] = 1
  while (stack.length) {
    const k = stack.pop()!
    const x = k % w
    for (const nb of [k - 1, k + 1, k - w, k + w]) {
      if (nb < 0 || nb >= w * h || out[nb] || mask[nb]) continue
      if (Math.abs((nb % w) - x) > 1) continue
      out[nb] = 1
      stack.push(nb)
    }
  }
  let holes = 0
  for (let i = 0; i < w * h; i++) if (!mask[i] && !out[i]) holes++
  return holes >= 3
}

/**
 * Where the clef and the time signature stand at the start of the line (x ranges, region
 * coordinates), from the ink with the lines erased:
 * - the clef: the first shape, much taller than the staff;
 * - a time signature: digits filling the staff from the top line to the bottom one, as much ink
 *   in the upper half as in the lower (a note with its stem has its head at one end).
 */
function headerRanges(ink: Uint8Array, w: number, h: number, top: number, bottom: number, sp: number): { clef: [number, number] | null; times: [number, number][] } {
  const limit = Math.min(w, Math.round(sp * 16))
  // Ink columns within the staff height (± a little), joined into shapes by x.
  const shapes: { x0: number; x1: number; y0: number; y1: number; upper: number; lower: number }[] = []
  const y0 = Math.max(0, Math.round(top - sp * 3))
  const y1 = Math.min(h - 1, Math.round(bottom + sp * 3))
  const mid = (top + bottom) / 2
  let cur: (typeof shapes)[number] | null = null
  for (let x = 0; x < limit; x++) {
    let lo = -1
    let hi = -1
    let up = 0
    let low = 0
    for (let y = y0; y <= y1; y++) {
      if (!ink[y * w + x]) continue
      if (lo < 0) lo = y
      hi = y
      if (y < mid) up++
      else low++
    }
    if (lo < 0) {
      if (cur) shapes.push(cur)
      cur = null
      continue
    }
    if (!cur) cur = { x0: x, x1: x, y0: lo, y1: hi, upper: up, lower: low }
    else {
      cur.x1 = x
      cur.y0 = Math.min(cur.y0, lo)
      cur.y1 = Math.max(cur.y1, hi)
      cur.upper += up
      cur.lower += low
    }
  }
  if (cur) shapes.push(cur)
  const out: [number, number][] = []
  const tall = shapes.find((s) => s.y1 - s.y0 >= (bottom - top) * 1.3)
  const clef = tall && tall.x0 < sp * 4 ? tall : null
  for (const s of shapes) {
    if (s === clef || s.x1 - s.x0 < sp * 1.0 || s.x1 - s.x0 > sp * 2.2) continue
    const fills = Math.abs(s.y0 - top) <= sp * 0.5 && Math.abs(s.y1 - bottom) <= sp * 0.5
    const balanced = s.upper > 0 && s.lower > 0 && s.upper / s.lower > 0.6 && s.upper / s.lower < 1.7
    if (fills && balanced) out.push([s.x0, s.x1])
  }
  return { clef: clef ? [clef.x0, clef.x1] : null, times: out }
}

/**
 * The ink around a head centre, out to about a head's size (stems and lines leaving it are cut
 * off by the limits). For a hollow head the centre is white: grow from the ring instead.
 */
function extent(ink: Uint8Array, w: number, h: number, cx: number, cy: number, sp: number, hollow = false) {
  const lim = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const maxX = Math.round(sp * (hollow ? 1.0 : 1.2))
  const maxY = Math.round(sp * 0.7)
  let x0 = cx
  let x1 = cx
  let y0 = cy
  let y1 = cy
  // Horizontal: along the centre row, through ink (and across a hollow centre).
  const row = lim(cy, 0, h - 1)
  let x = cx
  if (hollow) while (x > cx - maxX && x > 0 && !ink[row * w + x]) x--
  while (x > cx - maxX && x > 0 && ink[row * w + x - 1]) x--
  x0 = x
  x = cx
  if (hollow) while (x < cx + maxX && x < w - 1 && !ink[row * w + x]) x++
  while (x < cx + maxX && x < w - 1 && ink[row * w + x + 1]) x++
  x1 = x
  const col = lim(cx, 0, w - 1)
  let y = cy
  if (hollow) while (y > cy - maxY && y > 0 && !ink[y * w + col]) y--
  while (y > cy - maxY && y > 0 && ink[(y - 1) * w + col]) y--
  y0 = y
  y = cy
  if (hollow) while (y < cy + maxY && y < h - 1 && !ink[y * w + col]) y++
  while (y < cy + maxY && y < h - 1 && ink[(y + 1) * w + col]) y++
  y1 = y
  return { x0, y0, x1, y1 }
}
