import { describe, expect, it } from 'vitest'
import { findStaffSymbols, trebleStepName } from './noteHeads'
import type { Gray, Staff } from './tabDetect'

const SP = 20
const TOP = 100
const LINES = [0, 1, 2, 3, 4].map((i) => TOP + i * SP)

/** A white page with a five-line staff from x 20 to 780, bar lines at both ends. */
function page() {
  const g: Gray = { width: 800, height: 300, data: new Uint8Array(800 * 300).fill(255) }
  const dot = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < g.width && y < g.height) g.data[Math.round(y) * g.width + Math.round(x)] = 0
  }
  for (const ly of LINES) for (let x = 20; x <= 780; x++) dot(x, ly)
  for (const bx of [20, 780]) for (let y = TOP; y <= TOP + 4 * SP; y++) dot(bx, y)
  return { g, dot }
}

/** An ellipse at (cx, cy): filled, or a ring with a white hole. */
function head(dot: (x: number, y: number) => void, cx: number, cy: number, filled: boolean) {
  const a = SP * 0.65
  const b = SP * 0.5
  for (let y = -b; y <= b; y++)
    for (let x = -a; x <= a; x++) {
      const r = (x / a) ** 2 + (y / b) ** 2
      if (r <= 1 && (filled || r >= 0.45)) dot(cx + x, cy + y)
    }
}

const staff = (): Staff => ({ kind: 'staff', lines: LINES, spacing: SP, x0: 20, x1: 780, barLines: [20, 780], numbers: [], columns: [] })

describe('note heads', () => {
  it('names treble clef steps', () => {
    expect(trebleStepName(0)).toBe('F5')
    expect(trebleStepName(8)).toBe('E4')
    expect(trebleStepName(10)).toBe('C4')
    expect(trebleStepName(-2)).toBe('A5')
  })

  it('finds filled heads with stems, hollow heads and rests, with their pitch', () => {
    const { g, dot } = page()
    // Quarter note G4 (second line), stem up on the right.
    head(dot, 200, LINES[3], true)
    for (let y = LINES[3] - SP * 3.5; y <= LINES[3]; y++) for (let k = 0; k < 2; k++) dot(200 + SP * 0.6 + k, y)
    // Quarter note on the top space (E5), stem down on the left.
    head(dot, 300, TOP + SP * 0.5, true)
    for (let y = TOP + SP * 0.5; y <= TOP + SP * 4; y++) for (let k = 0; k < 2; k++) dot(300 - SP * 0.6 - k, y)
    // Whole note A4 (second space from the bottom).
    head(dot, 420, TOP + SP * 2.5, false)
    // A filled blob with no stem is not a note.
    head(dot, 500, LINES[2], true)
    // Whole rest hanging from the fourth line (second from the top).
    for (let y = LINES[1]; y <= LINES[1] + SP * 0.5; y++) for (let x = 600; x <= 624; x++) dot(x, y)
    const { heads, rests } = findStaffSymbols(g, staff())
    expect(heads.map((h) => [Math.round(h.x / 10), trebleStepName(h.step), h.filled])).toEqual([
      [20, 'G4', true],
      [30, 'E5', true],
      [42, 'A4', false],
    ])
    expect(rests.map((r) => r.value)).toEqual([1])
  })
})
