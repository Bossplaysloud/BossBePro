// Finds where things are on a TAB sheet image without AI: staff/TAB lines, bar lines, and the
// fret numbers with the string and column each sits on. Reading what each number is comes later.
//
// Method (as in optical music recognition): lines are rows covered by long horizontal runs (digits
// and notes only make short runs, and TAB digits cut gaps into the lines); evenly spaced lines form
// a staff; TAB staves are the ones with wider spacing; bar lines are columns dark from the top TAB
// line to the bottom one; with the lines erased, what is left in the TAB are the numbers, and each
// number's string is the line nearest its centre.

import { findStaffSymbols, type NoteHead, type StaffRest } from './noteHeads'

export interface Gray {
  width: number
  height: number
  data: Uint8Array // luminance 0–255, row by row
}

export interface Box {
  x0: number
  y0: number
  x1: number // inclusive
  y1: number
}

export interface TabNumber {
  box: Box
  string: number // 1 = top line
  column: number // index into Staff.columns
  measure: number // index into the staff's measures (between bar lines)
  offLine: number // distance from the line, in line spacings (0 = centred on it)
  /** The string could not be confirmed on the high-contrast image (between two lines). */
  uncertain?: boolean
  /**
   * What joins this number to the next one on the same string: an arc (hammer-on, pull-off or
   * tie — which one follows from the two frets) or a slanted stroke (slide); a stroke after the
   * number with no number following on that string is a slide out.
   */
  link?: 'arc' | 'slide' | 'slideOut'
  /** Column index of the number the link goes to. */
  linkTo?: number
  /** Printed clearly smaller than the other numbers: a grace note. */
  small?: boolean
  /** Not a number but a slide stroke ("/", "\\") or a piece of an arc: kept for linking, not read. */
  stroke?: boolean
}

export interface Staff {
  kind: 'tab' | 'staff'
  lines: number[] // y of each line, top first (hidden lines filled in)
  spacing: number
  x0: number
  x1: number
  barLines: number[] // x
  numbers: TabNumber[]
  columns: number[] // x centre of each column, left to right
  /** Rhythm printed under the TAB (stems, beams, dots, tuplet brackets), per column; null where none was found. */
  rhythm?: (ColumnRhythm | null)[]
  /** Staff: horizontal ranges under a tuplet bracket ("⌐ 3 ¬" above or "⌊ 3 ⌋" below the staff). */
  tuplets?: [number, number][]
  /** Staff: the number read on each tuplet bracket (same order as `tuplets`): 3, 5 or 6, 0 when unsure. */
  tupletNumbers?: number[]
  /** Staff: note heads found on it, with the line or space each sits on. */
  heads?: NoteHead[]
  /** Staff: rests found on it. */
  rests?: StaffRest[]
  /** Staff: the key signature at its start, as measured (sharps +, flats −). */
  keySignature?: number
}

export interface ColumnRhythm {
  duration: 1 | 2 | 4 | 8 | 16 | 32
  dotted: boolean
  /** Under a tuplet bracket. */
  triplet: boolean
  /** The bracket's number, guessed from the stems under it: 6 over six stems, else 3. */
  tuplet?: number
}

export interface Detection {
  width: number
  height: number
  staves: Staff[]
}

export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const data = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) data[i] = Math.round(rgba[i * 4] * 0.3 + rgba[i * 4 + 1] * 0.59 + rgba[i * 4 + 2] * 0.11)
  return { width, height, data }
}

/**
 * Raises the black-and-white contrast before anything is measured: the paper becomes pure white,
 * the darkest ink pure black, and greys in between are pushed towards black (a gamma curve), so
 * thin grey lines and the edges of digits are not lost against the background.
 */
export function enhanceContrast(g: Gray, gamma = 1.3): Gray {
  const hist = new Array<number>(256).fill(0)
  for (const v of g.data) hist[v]++
  const at = (share: number) => {
    let n = 0
    for (let v = 0; v < 256; v++) if ((n += hist[v]) >= g.data.length * share) return v
    return 255
  }
  // Most of a sheet is paper: the median is the paper colour; the darkest 0.5 % is the ink.
  const paper = Math.max(at(0.5), 1)
  const ink = Math.min(at(0.005), paper - 1)
  const map = new Uint8Array(256)
  for (let v = 0; v < 256; v++) {
    const t = Math.max(0, Math.min(1, (v - ink) / (paper - ink)))
    map[v] = Math.round(255 * t ** gamma)
  }
  const data = new Uint8Array(g.data.length)
  for (let i = 0; i < data.length; i++) data[i] = map[g.data[i]]
  return { width: g.width, height: g.height, data }
}

/**
 * The tilt of a scanned or photographed page, in degrees: staff lines show as sharp peaks in the
 * row profile only when the rows follow them, so the angle giving the sharpest profile wins.
 */
export function estimateSkew(g: Gray, maxDegrees = 4): number {
  const { width: w, height: h, data } = g
  const step = Math.max(1, Math.round(w / 600)) // a coarse sample is plenty
  const points: [number, number][] = []
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (data[y * w + x] < 160) points.push([x - w / 2, y])
  if (points.length < 50) return 0
  const score = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180)
    const rows = new Map<number, number>()
    for (const [x, y] of points) {
      const r = Math.round(y + x * t)
      rows.set(r, (rows.get(r) ?? 0) + 1)
    }
    let sum = 0
    for (const v of rows.values()) sum += v * v
    return sum
  }
  let best = 0
  let bestScore = score(0)
  for (let d = -maxDegrees; d <= maxDegrees + 1e-9; d += 0.1) {
    const sc = score(d)
    if (sc > bestScore) {
      bestScore = sc
      best = d
    }
  }
  return Math.round(best * 100) / 100
}

/** Lines are often thin and grey; anything clearly not white counts for them. */
const LINE_DARK = 235
/** For finding lines only: TAB lines are sometimes so faint that only this catches them (long runs keep it safe). */
const LINE_FAINT = 245
/** Numbers and symbols: properly dark pixels. */
const INK_DARK = 170

interface Line {
  y: number
  x0: number
  x1: number
  thickness: number
}

/** Rows covered by long horizontal runs, merged into lines with their horizontal extent. */
export function findLines(g: Gray): Line[] {
  const { width: w, height: h, data } = g
  const minRun = Math.max(8, Math.round(w * 0.008))
  const cover: number[] = []
  const ext: [number, number][] = []
  for (let y = 0; y < h; y++) {
    let sum = 0
    let run = 0
    let lo = w
    let hi = -1
    for (let x = 0; x <= w; x++) {
      // A thin line that falls between two pixel rows shows as two faint rows with white either
      // side: their darkness is added. (A line that is already dark is not made thicker.)
      const at = (yy: number) => (yy >= 0 && yy < h && x < w ? data[yy * w + x] : 255)
      const pair = at(y) >= LINE_DARK && at(y - 1) >= LINE_DARK && at(y + 2) >= LINE_DARK && at(y) + at(y + 1) - 255 < LINE_DARK
      const dark = x < w && (data[y * w + x] < LINE_FAINT || pair)
      if (dark) run++
      else {
        if (run >= minRun) {
          sum += run
          lo = Math.min(lo, x - run)
          hi = Math.max(hi, x - 1)
        }
        run = 0
      }
    }
    cover.push(sum / w)
    ext.push([lo, hi])
  }
  const max = Math.max(...cover)
  if (max < 0.1) return []
  const lines: Line[] = []
  let start = -1
  for (let y = 0; y <= h; y++) {
    const on = y < h && cover[y] >= Math.max(0.12, max * 0.3)
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      // Thick lines drawn close together (handwritten or heavy print) can run into one band, with
      // notes filling the narrow gaps: split the band at each clear dip in coverage.
      for (const [a, b] of splitBand(cover, start, y)) {
        const rows = ext.slice(a, b)
        // A thick dark band (a beam, a filled area) is not a line.
        if (b - a <= Math.max(6, Math.round(w / 120))) lines.push({ y: (a + b - 1) / 2, x0: Math.min(...rows.map((r) => r[0])), x1: Math.max(...rows.map((r) => r[1])), thickness: b - a })
      }
      start = -1
    }
  }
  return lines
}

/** Rows [a, b) split at dips where coverage falls clearly below the peaks on both sides. */
function splitBand(cover: number[], a: number, b: number): [number, number][] {
  if (b - a < 3) return [[a, b]]
  let cut = -1
  let deepest = Infinity
  for (let r = a + 1; r < b - 1; r++) {
    const left = Math.max(...cover.slice(a, r))
    const right = Math.max(...cover.slice(r + 1, b))
    const v = cover[r]
    if (v < 0.8 * Math.min(left, right) && v / Math.min(left, right) < deepest) {
      deepest = v / Math.min(left, right)
      cut = r
    }
  }
  if (cut < 0) return [[a, b]]
  // The dip row itself belongs to neither line.
  return [...splitBand(cover, a, cut), ...splitBand(cover, cut + 1, b)]
}

/** Line spacings that occur again and again on the page (one for staves, one for TAB). */
function commonSpacings(lines: Line[]): number[] {
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1]
    const b = lines[i]
    if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > (a.x1 - a.x0) * 0.5) gaps.push(b.y - a.y)
  }
  gaps.sort((a, b) => a - b)
  const out: number[] = []
  for (let i = 0; i < gaps.length; ) {
    let j = i
    // A cluster grows while each gap is close to the one before (lines vary by a pixel or two).
    while (j + 1 < gaps.length && gaps[j + 1] <= gaps[j] * 1.08 && gaps[j + 1] <= gaps[i] * 1.3) j++
    if (j - i + 1 >= 3 && gaps[i] >= 4 && !out.some((s) => Math.abs(gaps[i] / s - Math.round(gaps[i] / s)) < 0.12)) out.push(median(gaps.slice(i, j + 1)))
    i = j + 1
  }
  return out
}

/**
 * Evenly spaced lines with overlapping extents form a staff. Lines hidden by dense digits (or lost
 * when a screenshot was scaled down) are filled in where the gap is two or three spacings.
 */
function groupStaves(lines: Line[]): { lines: number[]; spacing: number; x0: number; x1: number }[] {
  const known = commonSpacings(lines)
  // How many spacings a gap spans, for one of the page's spacings.
  const steps = (gap: number, sp: number) => {
    const k = Math.round(gap / sp)
    return k >= 1 && k <= 3 && Math.abs(gap - k * sp) <= sp * (k === 1 ? 0.25 : 0.3) ? k : 0
  }
  const out: { lines: number[]; spacing: number; x0: number; x1: number }[] = []
  let i = 0
  while (i < lines.length) {
    const group: Line[] = [lines[i]]
    let spacing = 0
    const singles: number[] = [] // gaps of one spacing seen so far (the spacing follows their mean)
    let j = i + 1
    for (; j < lines.length; j++) {
      const prev = group[group.length - 1]
      const gap = lines[j].y - prev.y
      const overlap = Math.min(prev.x1, lines[j].x1) - Math.max(prev.x0, lines[j].x0)
      if (overlap < (prev.x1 - prev.x0) * 0.5) break
      // The first gap sets the spacing: the page spacing that explains it with the fewest hidden lines
      // (the closest one, when hand-drawn spacings vary).
      if (!spacing) {
        for (const k of [1, 2, 3]) {
          const fits = known.filter((sp) => steps(gap, sp) === k).sort((a, b) => Math.abs(gap - k * a) - Math.abs(gap - k * b))
          if (fits.length) {
            spacing = fits[0]
            break
          }
        }
      }
      const k = spacing ? steps(gap, spacing) : 0
      if (!k || group.length + k > 8) break
      if (k === 1) {
        singles.push(gap)
        spacing = singles.reduce((t, x) => t + x, 0) / singles.length
      }
      for (let m = 1; m < k; m++) group.push({ ...prev, y: prev.y + (gap * m) / k, thickness: 0 })
      group.push(lines[j])
    }
    if (group.length >= 4 && spacing) {
      const ys = group.map((l) => l.y)
      const real = group.filter((l) => l.thickness)
      out.push({ lines: ys, spacing: (ys[ys.length - 1] - ys[0]) / (ys.length - 1), x0: median(real.map((l) => l.x0)), x1: median(real.map((l) => l.x1)) })
      i = j
    } else i++
  }
  return out
}

/** Dark pixels in a band around y (to tell on which side a missing line was). */
function bandInk(g: Gray, y: number, spacing: number, x0: number, x1: number) {
  let n = 0
  for (let yy = Math.round(y - spacing * 0.35); yy <= Math.round(y + spacing * 0.35); yy++) {
    if (yy < 0 || yy >= g.height) continue
    for (let x = Math.round(x0); x <= Math.round(x1); x++) if (g.data[yy * g.width + x] < INK_DARK) n++
  }
  return n
}

/**
 * Tuplet brackets above or below a staff ("⌐— 3 —¬", often slanting with the beams): find a
 * digit-sized piece near the staff, then follow a thin line out of it to the left and to the right.
 * Beams are thick, so they are not followed; a lone fingering digit or a letter has no lines.
 */
function findTupletBrackets(g: Gray, staff: Staff): { ranges: [number, number][]; numbers: number[] } {
  const { width: w, height: h, data } = g
  const sp = staff.spacing
  const top = staff.lines[0]
  const bottom = staff.lines[staff.lines.length - 1]
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] < INK_DARK
  // Thin: the dark run through (x, y) up and down is short.
  const thin = (x: number, y: number) => {
    let n = 1
    for (let d = 1; d <= sp * 0.4 && dark(x, y - d); d++) n++
    for (let d = 1; d <= sp * 0.4 && dark(x, y + d); d++) n++
    return n <= Math.max(2, sp * 0.42)
  }
  // Follow a thin line from (x, y) in direction dx; returns how far it runs.
  const follow = (x: number, y: number, dx: 1 | -1) => {
    let cy = y
    let gap = 0
    let run = 0
    let cx = x
    while (gap <= 2 && Math.abs(cx - x) < sp * 8) {
      cx += dx
      const hit = [0, -1, 1, -2, 2].map((d) => cy + d).find((yy) => dark(cx, yy) && thin(cx, yy))
      if (hit !== undefined) {
        cy = hit
        gap = 0
        run = Math.abs(cx - x)
      } else gap++
    }
    return run
  }
  const out: [number, number][] = []
  const numbers: number[] = []
  const bands: [number, number][] = [
    [Math.max(0, Math.round(top - sp * 4.5)), Math.round(top - sp * 0.5)],
    [Math.round(bottom + sp * 0.5), Math.min(h - 1, Math.round(bottom + sp * 4.5))],
  ]
  for (const [y0, y1] of bands) {
    const x0 = Math.max(0, Math.floor(staff.x0))
    const x1 = Math.min(w - 1, Math.ceil(staff.x1))
    const bw = x1 - x0 + 1
    const seen = new Uint8Array(bw * (y1 - y0 + 1))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = (y - y0) * bw + x - x0
        if (seen[k] || !dark(x, y)) continue
        // One connected piece.
        const stack = [[x, y]]
        seen[k] = 1
        let [bx0, by0, bx1, by1] = [x, y, x, y]
        let count = 0
        while (stack.length && count < 4000) {
          const [px, py] = stack.pop()!
          count++
          bx0 = Math.min(bx0, px)
          bx1 = Math.max(bx1, px)
          by0 = Math.min(by0, py)
          by1 = Math.max(by1, py)
          for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
            if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue
            const nk = (ny - y0) * bw + nx - x0
            if (!seen[nk] && dark(nx, ny)) {
              seen[nk] = 1
              stack.push([nx, ny])
            }
          }
        }
        const pw = bx1 - bx0 + 1
        const ph = by1 - by0 + 1
        // The tuplet number: about the size of a small digit, taller than wide and not solid
        // (a note head is a filled oval, wider than tall, often with ties or slurs either side).
        if (ph < sp * 0.6 || ph > sp * 1.7 || pw < sp * 0.3 || pw > sp * 1.3 || pw > ph * 0.95 || count > pw * ph * 0.65) continue
        const cy = Math.round((by0 + by1) / 2)
        let left = 0
        let right = 0
        // The line starts a little away from the number, at about its middle height.
        for (let off = 1; off <= sp * 0.7; off++) {
          for (let d = -Math.round(sp * 0.6); d <= Math.round(sp * 0.6); d++) {
            if (!left && dark(bx0 - off, cy + d) && thin(bx0 - off, cy + d)) left = follow(bx0 - off, cy + d, -1) + off
            if (!right && dark(bx1 + off, cy + d) && thin(bx1 + off, cy + d)) right = follow(bx1 + off, cy + d, 1) + off
          }
        }
        // A bracket on both sides (or a long one on one side, when the number sits at its end).
        if (left >= sp * 0.5 && right >= sp * 0.5) {
          out.push([bx0 - left, bx1 + right])
          numbers.push(readTupletDigit(dark, bx0, by0, bx1, by1))
        }
      }
    }
  }
  return { ranges: out, numbers }
}

/**
 * The tuplet number, from its shape: a closed loop in the lower half is a 6; no loop, with a
 * stroke down the upper left (the top of a 5) is a 5; no loop and the upper left open is a 3.
 * Anything else (a loop elsewhere, too small to tell) gives 0: unsure.
 */
function readTupletDigit(dark: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number): number {
  const w = x1 - x0 + 3
  const h = y1 - y0 + 3
  if (w < 5 || h < 7) return 0
  // White reachable from outside the box; white left over is inside a loop.
  const outside = new Uint8Array(w * h)
  const at = (x: number, y: number) => dark(x0 - 1 + x, y0 - 1 + y)
  const stack = [0]
  outside[0] = 1
  while (stack.length) {
    const k = stack.pop()!
    const x = k % w
    const y = (k - x) / w
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const nk = ny * w + nx
      if (outside[nk] || at(nx, ny)) continue
      outside[nk] = 1
      stack.push(nk)
    }
  }
  let holes = 0
  let holeY = 0
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      if (!outside[y * w + x] && !at(x, y)) {
        holes++
        holeY += y
      }
  if (holes >= 2) return holeY / holes > h * 0.5 ? 6 : 0
  // No loop: is the upper left inked (5) or open (3)?
  const rows = [Math.round(h * 0.25), Math.round(h * 0.32), Math.round(h * 0.4)]
  const leftCols = Math.max(1, Math.round(w * 0.3))
  const inkLeft = rows.filter((y) => Array.from({ length: leftCols }, (_, i) => i + 1).some((x) => at(x, y))).length
  return inkLeft >= 2 ? 5 : 3
}

/**
 * Rhythm printed under the TAB, as music software draws it: a stem hangs below each column (from
 * under its lowest number); a stem alone is a quarter, a clearly shorter one a half, no stem (when
 * the others have stems) a whole note; beams (or a flag) at the stem's foot halve the value once
 * each; a dot beside the foot adds half; a bracket with "3" below the feet makes a triplet ("6" a sextuplet).
 * Returns undefined when the TAB has no rhythm under it.
 */
function findRhythm(g: Gray, staff: Staff): (ColumnRhythm | null)[] | undefined {
  const { width: w, height: h, data } = g
  const sp = staff.spacing
  const bottom = staff.lines[staff.lines.length - 1]
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] < INK_DARK
  const digits = staff.numbers.filter((n) => !n.stroke)
  type Stem = { x: number; top: number; foot: number }
  const stems: (Stem | null)[] = staff.columns.map((cx, ci) => {
    const inColumn = digits.filter((n) => n.column === ci)
    if (!inColumn.length) return null
    const start = Math.max(...inColumn.map((n) => n.box.y1)) + 1
    let best: Stem | null = null
    for (let x = Math.round(cx - sp * 0.5); x <= Math.round(cx + sp * 0.5); x++) {
      // The longest dark run going down from under the lowest number.
      let y = start
      while (y < start + sp * 0.6 && !dark(x, y)) y++
      const top = y
      let gap = 0
      while (y < bottom + sp * 6 && gap <= 1) {
        y++
        gap = dark(x, y) ? 0 : gap + 1
      }
      const foot = y - gap
      if (foot - top >= sp * 0.8 && foot > bottom + sp * 0.3 && (!best || foot - top > best.foot - best.top)) best = { x, top, foot }
    }
    return best
  })
  const found = stems.filter((s): s is Stem => !!s)
  // A flag or stem piece that was boxed as a number: it touches a stem below that column's numbers.
  for (const n of digits) {
    const owner = stems.find((st, ci) => st && ci !== n.column && n.box.x0 <= st.x + sp * 0.9 && n.box.x1 >= st.x - 1 && n.box.y0 >= st.top - 1 && n.box.y1 <= st.foot + sp * 0.5)
    if (owner) n.stroke = true
  }
  if (found.length < Math.max(2, digits.length ? staff.columns.length * 0.5 : 2)) return undefined
  // Length below the TAB: half notes hang shorter than the others.
  const below = (s: Stem) => s.foot - Math.max(s.top, bottom)
  const usual = median(found.map(below))
  const footLine = median(found.map((s) => s.foot))
  // Beams (or a flag) at the foot: rows beside the stem dark across most of a short span.
  const beamsAt = (s: Stem) => {
    let most = 0
    for (const side of [-1, 1]) {
      let count = 0
      let inBeam = false
      for (let y = s.foot; y >= s.foot - sp * 1.2; y--) {
        let n = 0
        const span = Math.max(3, Math.round(sp * 0.45))
        for (let k = 2; k < 2 + span; k++) if (dark(s.x + side * k, y)) n++
        const on = n >= span * 0.7
        if (on && !inBeam) count++
        inBeam = on
      }
      most = Math.max(most, count)
    }
    return most
  }
  // A dot: a small blob right of the foot that is not a beam.
  const dotAt = (s: Stem) => {
    let n = 0
    for (let y = Math.round(s.foot - sp * 0.35); y <= Math.round(s.foot + sp * 0.35); y++) for (let x = Math.round(s.x + sp * 0.25); x <= Math.round(s.x + sp * 0.7); x++) if (dark(x, y)) n++
    const area = sp * 0.7 * sp * 0.45
    return n >= area * 0.12 && n <= area * 0.6
  }
  // Tuplet brackets below the feet: on one row, line pieces either side of the "3" (joined across
  // the gap the digit leaves), or one long line; the stems above the bracket are tuplets.
  const bracketRanges: [number, number][] = []
  // The digit read in the gap of each bracket (0 when it has no gap or the digit is unclear).
  const bracketDigits: number[] = []
  const digitIn = (x0: number, x1: number, y: number) => {
    let bx0 = Infinity
    let bx1 = -1
    let by0 = Infinity
    let by1 = -1
    for (let yy = Math.round(y - sp * 1.1); yy <= Math.round(y + sp * 1.1); yy++)
      for (let x = x0; x <= x1; x++)
        if (dark(x, yy)) {
          bx0 = Math.min(bx0, x)
          bx1 = Math.max(bx1, x)
          by0 = Math.min(by0, yy)
          by1 = Math.max(by1, yy)
        }
    return bx1 < 0 ? 0 : readTupletDigit(dark, bx0, by0, bx1, by1)
  }
  for (let y = Math.round(footLine + sp * 0.3); y <= Math.round(footLine + sp * 2.2); y++) {
    const runs: [number, number][] = []
    let run = 0
    for (let x = 0; x <= w; x++) {
      if (x < w && dark(x, y)) run++
      else {
        if (run >= sp * 0.4) runs.push([x - run, x - 1])
        run = 0
      }
    }
    for (let i = 0; i < runs.length; i++) {
      let [a, b] = runs[i]
      let pieces = 1
      let gap: [number, number] | null = null
      while (i + 1 < runs.length && runs[i + 1][0] - b <= sp * 1.6) {
        if (!gap) gap = [b + 1, runs[i + 1][0] - 1]
        b = runs[++i][1]
        pieces++
      }
      if ((pieces >= 2 && b - a >= sp * 1.8) || b - a >= sp * 2.5) {
        bracketRanges.push([a, b])
        bracketDigits.push(gap ? digitIn(gap[0], gap[1], y) : 0)
      }
    }
  }
  const bracketAt = (x: number) => bracketRanges.findIndex(([a, b]) => x >= a - sp * 0.5 && x <= b + sp * 0.5)
  const bracketOf = stems.map((s) => (s ? bracketAt(s.x) : -1))
  const beamed = stems.map((s) => (s ? beamsAt(s) : 0))
  return stems.map((s, i) => {
    if (!s) return found.length >= staff.columns.length * 0.8 ? { duration: 1 as const, dotted: false, triplet: false } : null
    const beams = beamed[i]
    const duration = (beams >= 3 ? 32 : beams === 2 ? 16 : beams === 1 ? 8 : below(s) < usual * 0.65 ? 2 : 4) as ColumnRhythm['duration']
    const dotted = !(beams && beamed[i + 1]) && dotAt(s)
    const k = bracketOf[i]
    if (k < 0) return { duration, dotted, triplet: false }
    // The digit read in the bracket's gap; when unreadable, six stems under it make a sextuplet.
    return { duration, dotted, triplet: true, tuplet: bracketDigits[k] || (bracketOf.filter((j) => j === k).length === 6 ? 6 : 3) }
  })
}

/**
 * A slide stroke or a piece of an arc rather than a digit: thin (little ink for its box) and
 * slanted (the ink sits at clearly different heights in its left and right parts).
 */
function isStroke(g: Gray, box: Box, lines: number[], spacing: number) {
  const { width: w, data } = g
  const thick = Math.max(1, Math.round(spacing * 0.1))
  const bw = box.x1 - box.x0 + 1
  const bh = box.y1 - box.y0 + 1
  if (bw < bh * 0.4) return false // a narrow upright piece: "1"
  let ink = 0
  const third = Math.max(1, Math.floor(bw / 3))
  const ys: [number, number][] = [[0, 0], [0, 0]]
  for (let y = box.y0; y <= box.y1; y++) {
    if (lines.some((ly) => Math.abs(y - ly) <= thick)) continue
    for (let x = box.x0; x <= box.x1; x++) {
      if (data[y * w + x] >= INK_DARK) continue
      ink++
      if (x < box.x0 + third) (ys[0][0] += y, ys[0][1]++)
      else if (x > box.x1 - third) (ys[1][0] += y, ys[1][1]++)
    }
  }
  if (!ys[0][1] || !ys[1][1]) return false
  const slant = Math.abs(ys[0][0] / ys[0][1] - ys[1][0] / ys[1][1])
  return ink / (bw * bh) < 0.3 && slant > bh * 0.3
}

/**
 * Arcs and slide strokes between a number and the next one on the same string, measured on the
 * high-contrast image in the gap between the two boxes:
 * - an arc runs above or below the numbers: ink in most gap columns, well off the line;
 * - a slide is a slanted stroke across the line: ink near the line whose height changes across the gap.
 * Ink inside other number boxes and on the line rows themselves is ignored.
 */
function findLinks(g: Gray, staff: Staff) {
  const { width: w, height: h, data } = g
  const sp = staff.spacing
  const thick = Math.max(1, Math.round(sp * 0.1))
  // Ink of other numbers is ignored; strokes are what we are looking for, so they count.
  const digits = staff.numbers.filter((n) => !n.stroke)
  const height = (n: TabNumber) => n.box.y1 - n.box.y0 + 1
  const typical = median(digits.map(height))
  let skipped: TabNumber[] = []
  const inBox = (x: number, y: number) => digits.some((n) => !skipped.includes(n) && x >= n.box.x0 - 1 && x <= n.box.x1 + 1 && y >= n.box.y0 - 1 && y <= n.box.y1 + 1)
  // A pixel belongs to a string line when the ink runs straight on far to both sides and is no
  // thicker than a line (an arc that dips onto a line is thicker there). This works from the pixels
  // themselves, so a line whose position was only estimated (a faint line) is still recognised.
  const span = Math.max(4, Math.round(sp * 1.0))
  const runAt = (x: number, y: number) => {
    let n = 1
    for (let d = 1; d <= sp * 0.5 && y - d >= 0 && data[(y - d) * w + x] < INK_DARK; d++) n++
    for (let d = 1; d <= sp * 0.5 && y + d < h && data[(y + d) * w + x] < INK_DARK; d++) n++
    return n
  }
  // How thick the string lines are printed here (measured along the lines, away from numbers).
  const samples: number[] = []
  for (const ly of staff.lines)
    for (let x = Math.round(staff.x0 + sp); x < staff.x1 - sp; x += Math.max(2, Math.round(sp / 2))) {
      const y = [0, -1, 1].map((d) => Math.round(ly) + d).find((yy) => yy >= 0 && yy < h && data[yy * w + x] < INK_DARK)
      if (y !== undefined && !inBox(x, y)) samples.push(runAt(x, y))
    }
  const lineThick = samples.length ? median(samples) : Math.max(2, thick)
  const onLine = (y: number, x: number) => {
    if (runAt(x, y) > lineThick + 1) return false
    let along = 0
    for (let d = -span; d <= span; d++) {
      const xx = x + d
      if (xx < 0 || xx >= w) continue
      if ([y - 1, y, y + 1].some((yy) => yy >= 0 && yy < h && data[yy * w + xx] < LINE_DARK)) along++
    }
    return along >= (2 * span + 1) * 0.95
  }
  for (const a of digits) {
    if (a.stroke) continue
    const later = digits.filter((n) => n.string === a.string && n.column > a.column && !n.stroke)
    // A small piece right after the number is part of a slide stroke: look past it.
    skipped = []
    let b = later.shift()
    let prev = a
    while (b && height(b) < typical * 0.7 && b.box.x0 - prev.box.x1 < sp * 0.5 && later.length) {
      skipped.push(b)
      prev = b
      b = later.shift()
    }
    // A small piece right after the number with nothing after it: the stroke of a slide out.
    if (b && height(b) < typical * 0.7 && b.box.x0 - prev.box.x1 < sp * 0.5 && !later.length) {
      b.stroke = true
      a.link = 'slideOut'
      continue
    }
    if (!b) continue
    const x0 = Math.ceil(a.box.x1 + 2)
    const x1 = Math.floor(b.box.x0 - 2)
    if (x1 - x0 < Math.max(3, sp * 0.3)) continue
    const ly = staff.lines[a.string - 1]
    // For each gap column: whether there is ink above / below the line, and the mean height of the ink near it.
    let above = 0
    let below = 0
    const centre: number[] = []
    const covered: boolean[] = []
    for (let x = x0; x <= x1; x++) {
      let up = false
      let down = false
      let ySum = 0
      let yN = 0
      for (let y = Math.round(ly - sp * 1.1); y <= Math.round(ly + sp * 1.1); y++) {
        if (y < 0 || y >= h || x < 0 || x >= w || data[y * w + x] >= INK_DARK || onLine(y, x) || inBox(x, y)) continue
        if (y - ly < -sp * 0.35) up = true
        if (y - ly > sp * 0.35) down = true
        // A slide stroke crosses the line; an arc (often drawn with "sl." too) stays further off.
        if (Math.abs(y - ly) <= sp * 0.55) {
          ySum += y
          yN++
        }
      }
      if (up) above++
      if (down) below++
      covered.push(up || down)
      if (yN) centre.push(ySum / yN)
    }
    const cols = x1 - x0 + 1
    // A slide climbs or falls from one end of the gap to the other; an arc starts and ends at
    // about the same height (and bulges in between).
    const third = Math.max(1, Math.floor(centre.length / 3))
    const mean = (v: number[]) => v.reduce((t, y) => t + y, 0) / v.length
    const climb = centre.length >= 3 ? Math.abs(mean(centre.slice(0, third)) - mean(centre.slice(-third))) : 0
    // A small piece sitting on the line between the two numbers is the slide stroke itself.
    // An arc joins the two numbers: it reaches both ends of the gap and runs across its middle, and it is short (hammer-ons,
    // pull-offs and ties go to the very next note, a few spaces away at most).
    const part = Math.max(1, Math.floor(cols / 3))
    const share = (v: boolean[]) => v.filter(Boolean).length / Math.max(1, v.length)
    // ...and its middle: the tails of two separate arcs on either side of a gap are not one arc.
    const bothEnds = share(covered.slice(0, part)) >= 0.4 && share(covered.slice(-part)) >= 0.4 && share(covered.slice(part, cols - part)) >= 0.6
    if (skipped.length || (centre.length >= cols * 0.6 && climb >= sp * 0.35)) a.link = 'slide'
    else if ((above >= cols * 0.45 || below >= cols * 0.45) && bothEnds && cols <= sp * 4.5) a.link = 'arc'
    if (a.link) {
      a.linkTo = b.column
      for (const n of skipped) n.stroke = true
    }
  }
  // A stroke right after a number, with no number after it on the line: a slide out.
  for (const a of digits) {
    if (a.link || a.stroke) continue
    const stroke = staff.numbers.find((n) => n.stroke && n.string === a.string && n.box.x0 > a.box.x1 - 1 && n.box.x0 - a.box.x1 <= sp * 0.8)
    const later = digits.some((n) => !n.stroke && n !== a && n.string === a.string && n.box.x0 > a.box.x1 && n.box.x0 - a.box.x1 <= sp * 2.5)
    if (stroke && !later) a.link = 'slideOut'
  }
}

/**
 * Where each TAB line really runs beside a number: in short strips left and right of it, the row
 * near the expected line that is most covered by line pixels. Falls back to the staff-wide line.
 */
function localLines(g: Gray, box: Box, lines: number[], spacing: number): number[] {
  const { width: w, height: h, data } = g
  const reachX = Math.max(3, Math.round(spacing * 0.9))
  const strips = [
    [Math.max(0, box.x0 - reachX), box.x0 - 2],
    [box.x1 + 2, Math.min(w - 1, box.x1 + reachX)],
  ]
  return lines.map((ly) => {
    let best = ly
    let bestScore = 0
    for (let y = Math.round(ly - spacing * 0.35); y <= Math.round(ly + spacing * 0.35); y++) {
      if (y < 0 || y >= h) continue
      let n = 0
      for (const [a, b] of strips) for (let x = a; x <= b; x++) if (data[y * w + x] < LINE_DARK) n++
      if (n > bestScore) {
        bestScore = n
        best = y
      }
    }
    // A row is a line only if it is mostly covered beside the number; otherwise trust the staff line.
    return bestScore >= reachX * 0.8 ? best : ly
  })
}

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Columns dark all the way from the top line to the bottom line. */
function findBarLines(g: Gray, top: number, bottom: number, x0: number, x1: number, staffLines?: number[], spacing = 0, otherLines?: number[], checkHeads = true, relaxed = false): number[] {
  const { width: w, height: h, data } = g
  const y0 = Math.round(top)
  const y1 = Math.round(bottom)
  const hits: number[] = []
  for (let x = Math.max(0, Math.floor(x0) - 2); x <= Math.min(w - 1, Math.ceil(x1) + 2); x++) {
    let dark = 0
    for (let y = y0; y <= y1; y++) if (data[y * w + x] < LINE_DARK) dark++
    if (dark >= (y1 - y0 + 1) * 0.92) hits.push(x)
  }
  // Neighbouring columns are one bar line; a double bar line counts once.
  const runs: [number, number][] = []
  for (const x of hits) {
    const last = runs[runs.length - 1]
    if (last && x - last[1] <= 1) last[1] = x
    else runs.push([x, x])
  }
  // On a staff, a stem can cross all five lines too, but a stem ends in a note head at the top
  // or bottom line; a bar line has nothing beside its ends but the staff lines.
  const onLine = (y: number) => !!staffLines?.some((ly) => Math.abs(y - ly) <= Math.max(1, spacing * 0.12))
  // A note head at the end of the column: strictly, any ink near the end; relaxed (tight handwriting,
  // where notes after a bar line come close), only ink right beside the column, as a head on its stem.
  const headAt = (lo: number, hi: number, endY: number, loose = relaxed) => {
    let n = 0
    const side = loose ? Math.max(2, Math.round(spacing * 0.45)) : Math.round(spacing * 1.1)
    for (let y = Math.round(endY - spacing * 0.6); y <= Math.round(endY + spacing * 0.6); y++) {
      if (y < 0 || y >= h || onLine(y)) continue
      for (let x = lo - side; x <= hi + side; x++) if (x >= 0 && x < w && (x < lo - 1 || x > hi + 1) && data[y * w + x] < INK_DARK) n++
    }
    return n >= (loose ? spacing * side * 0.35 : spacing * spacing * 0.25)
  }
  // How far the dark column really runs: a stem goes on to a note head or a beam outside the staff.
  const reach = (x: number, from: number, step: 1 | -1) => {
    let y = from
    let gap = 0
    while (y + step >= 0 && y + step < h && gap <= 1) {
      y += step
      gap = data[y * w + x] < LINE_DARK || (x > 0 && data[y * w + x - 1] < LINE_DARK) || (x + 1 < w && data[y * w + x + 1] < LINE_DARK) ? 0 : gap + 1
    }
    return y - step * gap
  }
  // A note head on the stem anywhere down the staff (the column may look full while the stem only
  // reaches a head near the bottom).
  const headAlong = (lo: number, hi: number) => {
    for (let y = y0; y <= y1 + spacing * 0.5; y += Math.max(1, spacing * 0.5)) if (headAt(lo, hi, y, true)) return true
    return false
  }
  const full = new Set(hits)
  // Ink close on both sides of the column down the staff: a time signature's digits (the upright of
  // a "4" fills every row) or a stem beside its head, not a bar line, which has clear space beside it.
  const crowded = (lo: number, hi: number) => {
    if (!staffLines) return false
    const reachX = Math.max(3, Math.round(spacing * 0.6))
    const side = (from: number, to: number) => {
      let rows = 0
      let total = 0
      for (let y = y0; y <= y1; y++) {
        if (onLine(y)) continue
        total++
        for (let x = from; x <= to; x++) if (x >= 0 && x < w && !full.has(x) && data[y * w + x] < INK_DARK) { rows++; break }
      }
      return total ? rows / total : 0
    }
    const left = side(lo - reachX, lo - 2)
    const right = side(hi + 2, hi + reachX)
    return left > 0.15 && right > 0.15 && left + right > 0.5
  }
  const isBar = ([lo, hi]: [number, number]) => {
    if (!staffLines) return true
    if (checkHeads && crowded(lo, hi)) return false
    const x = Math.round((lo + hi) / 2)
    let up = reach(x, y0, -1)
    const down = reach(x, y1, 1)
    // Ending at another staff's line (a line joining staves) is fine; ending in the open is a stem.
    // (relaxed: hand-drawn bar lines often overshoot the outer lines a little)
    const endsWell = (y: number, own: number) => Math.abs(y - own) <= spacing * (relaxed ? 0.8 : 0.4) || !!otherLines?.some((ly) => Math.abs(ly - y) <= spacing * 0.4)
    // A measure number printed on top of the bar line makes it run on upwards. A stem that covers the
    // whole staff and goes on upwards has its head at the bottom line, so with no head there (and
    // a clean bottom end) the column is a bar line carrying its number.
    if (!endsWell(up, top) && up < top && top - up <= spacing * 2.5 && endsWell(down, bottom) && !headAlong(lo, hi)) up = top
    if (!endsWell(up, top) || !endsWell(down, bottom)) return false
    // Look for a note head where the column really ends (a stem's head may sit just past the staff).
    return !checkHeads || !(headAt(lo, hi, relaxed ? Math.min(up, top) : top) || headAt(lo, hi, relaxed ? Math.max(down, bottom) : bottom))
  }
  const bars = runs.filter(isBar).map(([lo, hi]) => (lo + hi) / 2)
  return bars.filter((x, i) => i === 0 || x - bars[i - 1] > (bottom - top) * 0.3)
}

/** Dark pixels in the TAB area with the lines and bar lines removed, as connected boxes. */
function findNumberBoxes(g: Gray, lines: number[], spacing: number, x0: number, x1: number, bars: number[]): Box[] {
  const { width: w, height: h, data } = g
  const top = Math.max(0, Math.floor(lines[0] - spacing * 0.7))
  const bottom = Math.min(h - 1, Math.ceil(lines[lines.length - 1] + spacing * 0.7))
  const left = Math.max(0, Math.floor(x0))
  const right = Math.min(w - 1, Math.ceil(x1))
  const bw = right - left + 1
  const bh = bottom - top + 1
  const ink = new Uint8Array(bw * bh)
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) ink[y * bw + x] = data[(top + y) * w + left + x] < INK_DARK ? 1 : 0
  // Erase line pixels: on a line row, a pixel whose vertical dark run is short belongs to the line.
  const lineRows = new Set<number>()
  for (const ly of lines) for (let d = -2; d <= 2; d++) lineRows.add(Math.round(ly) + d - top)
  const thick = Math.max(2, Math.round(spacing * 0.22))
  for (let x = 0; x < bw; x++) {
    for (const r of lineRows) {
      if (r < 0 || r >= bh || !ink[r * bw + x]) continue
      let up = r
      while (up > 0 && ink[(up - 1) * bw + x]) up--
      let down = r
      while (down < bh - 1 && ink[(down + 1) * bw + x]) down++
      if (down - up + 1 <= thick) for (let y = up; y <= down; y++) ink[y * bw + x] = 0
    }
  }
  for (const bx of bars) for (let x = Math.round(bx) - 2; x <= Math.round(bx) + 2; x++) if (x - left >= 0 && x - left < bw) for (let y = 0; y < bh; y++) ink[y * bw + x - left] = 0
  // Connected components (8-neighbour).
  const seen = new Uint8Array(bw * bh)
  const boxes: Box[] = []
  const stack: number[] = []
  for (let i = 0; i < bw * bh; i++) {
    if (!ink[i] || seen[i]) continue
    let bx0 = bw
    let by0 = bh
    let bx1 = -1
    let by1 = -1
    let count = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length) {
      const k = stack.pop()!
      const x = k % bw
      const y = (k - x) / bw
      count++
      bx0 = Math.min(bx0, x)
      bx1 = Math.max(bx1, x)
      by0 = Math.min(by0, y)
      by1 = Math.max(by1, y)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
          const n = ny * bw + nx
          if (ink[n] && !seen[n]) {
            seen[n] = 1
            stack.push(n)
          }
        }
    }
    if (count >= 3) boxes.push({ x0: bx0 + left, y0: by0 + top, x1: bx1 + left, y1: by1 + top })
  }
  // A hammer-on/slide arc touching a digit makes one wide piece: keep only the columns where the
  // ink is tall (digits), which splits the piece back into its digits.
  const pieces: Box[] = []
  for (const b of boxes) {
    if (b.x1 - b.x0 + 1 <= spacing * 0.95) {
      pieces.push(b)
      continue
    }
    let runStart = -1
    let lo = Infinity
    let hi = -1
    for (let x = b.x0; x <= b.x1 + 1; x++) {
      let y0 = Infinity
      let y1 = -1
      if (x <= b.x1)
        for (let y = b.y0; y <= b.y1; y++)
          if (ink[(y - top) * bw + x - left]) {
            y0 = Math.min(y0, y)
            y1 = Math.max(y1, y)
          }
      const tall = y1 - y0 + 1 >= spacing * 0.3
      if (tall) {
        if (runStart < 0) runStart = x
        lo = Math.min(lo, y0)
        hi = Math.max(hi, y1)
      } else if (runStart >= 0) {
        pieces.push({ x0: runStart, y0: lo, x1: x - 1, y1: hi })
        runStart = -1
        lo = Infinity
        hi = -1
      }
    }
  }
  // Erasing a line can cut a digit whose stroke lies on it into an upper and a lower half: join
  // pieces that overlap horizontally and nearly touch across a line.
  pieces.sort((a, b) => a.y0 - b.y0)
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i]
      const b = pieces[j]
      const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1
      const gapY = b.y0 - a.y1 - 1
      if (overlapX >= Math.min(a.x1 - a.x0, b.x1 - b.x0) * 0.5 && gapY >= -thick - 2 && gapY <= thick + 2 && Math.max(a.y1, b.y1) - a.y0 + 1 <= spacing * 1.05 && lines.some((ly) => ly >= Math.min(a.y1, b.y0) - thick - 1 && ly <= Math.max(a.y1, b.y0) + thick + 1)) {
        pieces[i] = { x0: Math.min(a.x0, b.x0), y0: a.y0, x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
        pieces.splice(j, 1)
        j = i
      }
    }
  }
  // Digit-sized pieces only: arcs, ties and stray marks are wider or thinner.
  const digits = pieces.filter((b) => {
    const bh2 = b.y1 - b.y0 + 1
    const bw2 = b.x1 - b.x0 + 1
    if (bh2 < spacing * 0.35 || bh2 > spacing * 1.5 || bw2 > spacing * 1.6) return false
    // Slide strokes and arc ends are thin diagonals: little ink for the size of their box.
    let n = 0
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) n += ink[(y - top) * bw + x - left]
    return n / (bh2 * bw2) >= 0.22
  })
  // Pieces side by side on the same line are one number ("12", "(5)").
  digits.sort((a, b) => a.x0 - b.x0)
  const merged: Box[] = []
  for (const b of digits) {
    const hit = merged.find((m) => b.x0 - m.x1 <= spacing * 0.25 && b.x0 >= m.x0 && Math.min(m.y1, b.y1) - Math.max(m.y0, b.y0) >= (b.y1 - b.y0) * 0.5)
    if (hit) {
      hit.x1 = Math.max(hit.x1, b.x1)
      hit.y0 = Math.min(hit.y0, b.y0)
      hit.y1 = Math.max(hit.y1, b.y1)
    } else merged.push({ ...b })
  }
  return merged
}

export function detectTab(input: Gray): Detection {
  const g = enhanceContrast(input)
  const groups = groupStaves(findLines(g))
  const narrow = Math.min(...groups.map((s) => s.spacing))
  const mixed = groups.some((s) => s.spacing > narrow * 1.2)
  // A TAB with fewer lines than the others lost its top or bottom line. Bar lines run exactly from
  // the top line to the bottom one, so the side that keeps them is the right one.
  const tabCounts = groups.filter((s) => (mixed ? s.spacing > narrow * 1.2 : s.lines.length !== 5)).map((s) => s.lines.length)
  const usual = tabCounts.length ? Math.max(...tabCounts) : 0
  for (const s of groups) {
    if (!(mixed ? s.spacing > narrow * 1.2 : s.lines.length !== 5)) continue
    while (s.lines.length < usual) {
      const above = s.lines[0] - s.spacing
      const below = s.lines[s.lines.length - 1] + s.spacing
      const barsBelow = findBarLines(g, s.lines[0], below, s.x0, s.x1).length
      const barsAbove = findBarLines(g, above, s.lines[s.lines.length - 1], s.x0, s.x1).length
      const down = barsBelow !== barsAbove ? barsBelow > barsAbove : bandInk(g, below, s.spacing, s.x0, s.x1) >= bandInk(g, above, s.spacing, s.x0, s.x1)
      if (down) s.lines.push(below)
      else s.lines.unshift(above)
    }
  }
  const relaxedBars = new Map<Staff, number[]>()
  const staves: Staff[] = groups.map((s) => {
    // With both kinds present, TAB lines are the wider spaced ones; alone, 5 lines is a staff.
    const kind = mixed ? (s.spacing > narrow * 1.2 ? 'tab' : 'staff') : s.lines.length === 5 ? 'staff' : 'tab'
    const staff: Staff = { kind, lines: s.lines, spacing: s.spacing, x0: s.x0, x1: s.x1, barLines: [], numbers: [], columns: [] }
    if (kind !== 'tab') {
      const others = groups.flatMap((o) => (o === s ? [] : [o.lines[0], o.lines[o.lines.length - 1]]))
      staff.barLines = findBarLines(g, s.lines[0], s.lines[s.lines.length - 1], s.x0, s.x1, s.lines, s.spacing, others)
      relaxedBars.set(staff, findBarLines(g, s.lines[0], s.lines[s.lines.length - 1], s.x0, s.x1, s.lines, s.spacing, others, true, true))
      const brackets = findTupletBrackets(g, staff)
      staff.tuplets = brackets.ranges
      staff.tupletNumbers = brackets.numbers
      if (s.lines.length === 5) {
        const found = findStaffSymbols(g, staff)
        staff.heads = found.heads
        staff.rests = found.rests
        staff.keySignature = found.keySignature
      }
      return staff
    }
    const top = s.lines[0]
    const bottom = s.lines[s.lines.length - 1]
    // TAB with rhythm under it: a stem from a number on a high string crosses every line too, but
    // goes on below the TAB; a bar line stops at the bottom line (or joins another staff).
    staff.barLines = findBarLines(g, top, bottom, s.x0, s.x1, s.lines, s.spacing, groups.flatMap((o) => (o === s ? [] : [o.lines[0], o.lines[o.lines.length - 1]])), false)
    // The "TAB" clef letters stand right after the start of each line.
    const found = findNumberBoxes(g, s.lines, s.spacing, s.x0, s.x1, staff.barLines).filter((b) => (b.x0 + b.x1) / 2 > s.x0 + s.spacing * 2.2)
    // A time signature in the TAB is printed much taller than the fret numbers.
    const usualHeight = median(found.map((b) => b.y1 - b.y0 + 1))
    const boxes = found.filter((b) => b.y1 - b.y0 + 1 <= usualHeight * 1.35)
    // Columns: numbers whose centres line up vertically.
    const centres = boxes.map((b) => (b.x0 + b.x1) / 2)
    const order = centres.map((_, i) => i).sort((a, b) => centres[a] - centres[b])
    const columnOf = new Array<number>(boxes.length)
    for (const i of order) {
      const last = staff.columns.length - 1
      if (last >= 0 && centres[i] - staff.columns[last] <= s.spacing * 0.55) columnOf[i] = last
      else {
        staff.columns.push(centres[i])
        columnOf[i] = staff.columns.length - 1
      }
    }
    staff.numbers = boxes.map((box, i) => {
      const cy = (box.y0 + box.y1) / 2
      const cx = centres[i]
      // Check on the high-contrast image: the lines measured right beside this number (they may
      // slope or bend in a photo), then the one nearest the number's centre.
      const local = localLines(g, box, s.lines, s.spacing)
      let string = 0
      local.forEach((ly, k) => {
        if (Math.abs(ly - cy) < Math.abs(local[string] - cy)) string = k
      })
      const offLine = Math.abs(local[string] - cy) / s.spacing
      return { box, string: string + 1, column: columnOf[i], measure: staff.barLines.filter((b) => b < cx).length, offLine, ...(offLine > 0.3 ? { uncertain: true } : {}) }
    })
    staff.numbers.sort((a, b) => a.column - b.column || a.string - b.string)
    for (const n of staff.numbers) if (isStroke(g, n.box, s.lines, s.spacing)) n.stroke = true
    // Grace notes are printed in a smaller size.
    const normal = median(staff.numbers.filter((n) => !n.stroke).map((n) => n.box.y1 - n.box.y0 + 1))
    for (const n of staff.numbers) if (!n.stroke && n.box.y1 - n.box.y0 + 1 < normal * 0.8) n.small = true
    findLinks(g, staff)
    staff.rhythm = findRhythm(g, staff)
    return staff
  })
  // Bar lines that only pass the relaxed test (handwriting) count when at least two other staves
  // have a bar line at about the same place: lead-sheet bars line up down the page, stems do not.
  const fives = staves.filter((st) => st.kind === 'staff')
  for (const st of fives) {
    const near = (x: number, o: Staff) => [...o.barLines, ...(relaxedBars.get(o) ?? [])].some((b) => Math.abs(b - x) <= st.spacing * 1.2)
    const extra = (relaxedBars.get(st) ?? []).filter((x) => !st.barLines.some((b) => Math.abs(b - x) <= st.spacing) && fives.filter((o) => o !== st && near(x, o)).length >= 2)
    if (extra.length) st.barLines = [...st.barLines, ...extra].sort((a, b) => a - b)
  }
  // Still missing: where most other staves have a bar line, a column dark all the way down this
  // staff is taken as one too (a note written tight against the bar line can hide it from the tests).
  for (const st of fives) {
    const others = fives.filter((o) => o !== st)
    if (others.length < 2) continue
    const candidates = others.flatMap((o) => o.barLines)
    for (const x of candidates) {
      if (st.barLines.some((b) => Math.abs(b - x) <= st.spacing * 1.5)) continue
      if (others.filter((o) => o.barLines.some((b) => Math.abs(b - x) <= st.spacing * 1.2)).length < Math.max(2, Math.ceil(others.length * 0.6))) continue
      const top = Math.round(st.lines[0])
      const bottom = Math.round(st.lines[st.lines.length - 1])
      for (let cx = Math.round(x - st.spacing); cx <= Math.round(x + st.spacing); cx++) {
        let dark = 0
        for (let y = top; y <= bottom; y++) if ([cx - 1, cx, cx + 1].some((xx) => xx >= 0 && xx < g.width && g.data[y * g.width + xx] < LINE_DARK)) dark++
        if (dark >= (bottom - top + 1) * 0.95) {
          st.barLines = [...st.barLines, cx].sort((a, b) => a - b)
          break
        }
      }
    }
  }
  return { width: g.width, height: g.height, staves }
}
