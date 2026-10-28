// Finds the lines of music (systems) on a sheet image so each can be sent to the AI on its own,
// at a size where small TAB digits stay readable.

export interface RowStats {
  ink: number // share of dark pixels in the row (0–1)
  run: number // share of the row that is not white: high on staff and TAB lines (0–1)
}

/** Staff and TAB lines: rows covered across most of the width. */
function staffLines(rows: RowStats[]): number[] {
  const lines: number[] = []
  let start = -1
  rows.forEach((r, y) => {
    const on = r.run >= 0.5
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      lines.push((start + y - 1) / 2)
      start = -1
    }
  })
  if (start >= 0) lines.push((start + rows.length - 1) / 2)
  return lines
}

/** Groups evenly spaced lines into staves; TAB digits can hide a line, so one missing line is allowed. */
function staves(lines: number[]): number[][] {
  if (lines.length < 3) return []
  const gaps = lines.slice(1).map((y, i) => y - lines[i]).sort((a, b) => a - b)
  const spacing = gaps[Math.floor(gaps.length / 4)] // a gap inside a staff
  const groups: number[][] = [[lines[0]]]
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] - lines[i - 1] > spacing * 3.2) groups.push([])
    groups[groups.length - 1].push(lines[i])
  }
  return groups.filter((g) => g.length >= 3)
}

/** Line spacing of a staff, ignoring gaps left by a hidden line. */
function lineSpacing(g: number[]) {
  const gaps = g.slice(1).map((y, i) => y - g[i]).sort((a, b) => a - b)
  const base = gaps[0]
  const near = gaps.filter((x) => x < base * 1.5)
  return near.reduce((a, b) => a + b, 0) / near.length
}

/**
 * Row indexes where the image should be cut, between systems. TAB lines are spaced wider than
 * staff lines; when both appear, a system is the staff with the TAB under it, otherwise each staff
 * stands alone. Empty when there is one system.
 */
export function systemBreaks(rows: RowStats[]): number[] {
  const groups = staves(staffLines(rows))
  if (groups.length < 2) return []
  const spacings = groups.map(lineSpacing)
  const narrow = Math.min(...spacings)
  const isTab = spacings.map((s) => s > narrow * 1.25)
  const mixed = isTab.some(Boolean) && isTab.some((t) => !t)
  // Index of the last staff of each system.
  const ends = groups.flatMap((_, i) => ((!mixed || isTab[i]) && i < groups.length - 1 ? [i] : []))
  return ends.map((i) => {
    const from = Math.ceil(groups[i][groups[i].length - 1]) + 2
    const to = Math.floor(groups[i + 1][0]) - 2
    if (to <= from) return Math.round((from + to) / 2)
    // The emptiest row in the gap; among equals, the one nearest the middle.
    const mid = (from + to) / 2
    let best = from
    for (let y = from; y <= to; y++) {
      const a = rows[y].ink
      const b = rows[best].ink
      if (a < b - 1e-4 || (Math.abs(a - b) <= 1e-4 && Math.abs(y - mid) < Math.abs(best - mid))) best = y
    }
    return best
  })
}

export function rowStats(canvas: HTMLCanvasElement): RowStats[] {
  // Measured on a copy about 1000 px wide: plenty for finding lines, and fast.
  const scale = Math.min(1, 1000 / canvas.width)
  const w = Math.max(1, Math.round(canvas.width * scale))
  const h = Math.max(1, Math.round(canvas.height * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(canvas, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const rows: RowStats[] = []
  for (let y = 0; y < h; y++) {
    let ink = 0
    let grey = 0
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4
      const lum = data[k] * 0.3 + data[k + 1] * 0.59 + data[k + 2] * 0.11
      if (lum < 190) ink++
      // Staff and TAB lines are often thin and grey, and TAB digits cut gaps into them.
      if (lum < 240) grey++
    }
    rows.push({ ink: ink / w, run: grey / w })
  }
  return rows
}

/** Vertical ranges (0–1) of the systems in the image; a single range when it cannot be split. */
export function findSystems(canvas: HTMLCanvasElement): [number, number][] {
  const rows = rowStats(canvas)
  const cuts = systemBreaks(rows)
  const edges = [0, ...cuts.map((y) => y / rows.length), 1]
  return edges.slice(1).map((y, i) => [edges[i], y])
}
