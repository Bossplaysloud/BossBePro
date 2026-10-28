import { describe, expect, it } from 'vitest'
import { systemBreaks, type RowStats } from './systems'

/** Rows of a page: each entry is [first line row, line count, spacing]. */
function page(staves: [number, number, number][], height: number): RowStats[] {
  const rows: RowStats[] = Array.from({ length: height }, () => ({ ink: 0, run: 0 }))
  for (const [top, count, spacing] of staves) for (let i = 0; i < count; i++) rows[top + i * spacing] = { ink: 0.9, run: 0.9 }
  // notes between the staves add a little ink
  for (let y = 0; y < height; y++) if (!rows[y].run && y % 7 === 0) rows[y] = { ink: 0.05, run: 0.01 }
  return rows
}

describe('system breaks', () => {
  it('cuts after each TAB when a staff and TAB form a system', () => {
    const rows = page([[50, 5, 8], [120, 6, 12], [250, 5, 8], [320, 6, 12], [450, 5, 8], [520, 6, 12]], 640)
    const cuts = systemBreaks(rows)
    expect(cuts).toHaveLength(2)
    expect(cuts[0]).toBeGreaterThan(170)
    expect(cuts[0]).toBeLessThan(250)
    expect(cuts[1]).toBeGreaterThan(370)
    expect(cuts[1]).toBeLessThan(450)
  })

  it('cuts between staves of the same kind, and not at all for one system', () => {
    expect(systemBreaks(page([[50, 6, 12], [200, 6, 12], [350, 6, 12]], 450))).toHaveLength(2)
    expect(systemBreaks(page([[50, 5, 8], [120, 6, 12]], 200))).toEqual([])
  })
})
