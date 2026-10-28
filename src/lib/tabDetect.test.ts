import { describe, expect, it } from 'vitest'
import { detectTab, type Gray } from './tabDetect'

/** A white page with a 6-line TAB, bar lines and "digits" (small dark blocks with a hole). */
function page(opts: { hideLine?: number; digits: [number, number][]; between?: number; stems?: { x: number; from: number; beamTo?: number; beams?: number }[] }): Gray {
  const width = 800
  const height = 300
  const data = new Uint8Array(width * height).fill(255)
  const set = (x: number, y: number, v = 60) => (data[y * width + x] = v)
  const lines = [60, 84, 108, 132, 156, 180]
  lines.forEach((y, i) => {
    if (i === opts.hideLine) return
    for (let x = 40; x < 760; x++) set(x, y, 150)
  })
  for (const bx of [40, 400, 759]) for (let y = 60; y <= 180; y++) set(bx, y, 60)
  // Each digit: a 12×18 block with a white hole, centred on its string's line, white around it.
  for (const [x, string] of opts.digits) {
    const cy = lines[string - 1]
    for (let y = cy - 12; y <= cy + 12; y++) for (let xx = x - 9; xx <= x + 9; xx++) set(xx, y, 255)
    for (let y = cy - 9; y <= cy + 9; y++) for (let xx = x - 6; xx <= x + 6; xx++) set(xx, y, Math.abs(y - cy) < 4 && Math.abs(xx - x) < 3 ? 255 : 40)
  }
  // Rhythm under the TAB: stems down to y = 240, beams at their feet.
  for (const st of opts.stems ?? []) {
    for (let y = st.from; y <= 240; y++) for (let d = 0; d <= 1; d++) set(st.x + d, y, 30)
    for (let k = 0; k < (st.beams ?? 0); k++) for (let y = 236 - k * 7; y <= 240 - k * 7; y++) for (let x = st.x; x <= (st.beamTo ?? st.x); x++) set(x, y, 30)
  }
  // A digit drawn halfway between strings 3 and 4.
  if (opts.between) {
    const cy = 120
    const x = opts.between
    for (let y = cy - 12; y <= cy + 12; y++) for (let xx = x - 9; xx <= x + 9; xx++) set(xx, y, 255)
    for (let y = cy - 9; y <= cy + 9; y++) for (let xx = x - 6; xx <= x + 6; xx++) set(xx, y, Math.abs(y - cy) < 4 && Math.abs(xx - x) < 3 ? 255 : 40)
  }
  return { width, height, data }
}

describe('TAB detection', () => {
  const digits: [number, number][] = [[120, 2], [120, 3], [120, 4], [120, 6], [200, 6], [280, 1], [480, 5], [560, 2], [560, 5]]

  it('finds the lines, bar lines, and each number with its string, column and measure', () => {
    const d = detectTab(page({ digits }))
    const tab = d.staves.find((s) => s.kind === 'tab')!
    expect(tab.lines.map(Math.round)).toEqual([60, 84, 108, 132, 156, 180])
    expect(tab.barLines.map(Math.round)).toEqual([40, 400, 759])
    expect(tab.columns).toHaveLength(5)
    expect(tab.numbers.map((n) => `${n.measure}:${n.column}:${n.string}`)).toEqual(['1:0:2', '1:0:3', '1:0:4', '1:0:6', '1:1:6', '1:2:1', '2:3:5', '2:4:2', '2:4:5'])
  })

  it('confirms strings beside each number and flags one between two lines', () => {
    const tab = detectTab(page({ digits, between: 640 })).staves.find((s) => s.kind === 'tab')!
    expect(tab.numbers.filter((n) => n.uncertain).map((n) => Math.round((n.box.x0 + n.box.x1) / 2))).toEqual([640])
  })

  it('reads the rhythm printed under the TAB: stems, beams, and stems crossing the TAB are not bar lines', () => {
    const tab = detectTab(
      page({
        digits: [[120, 1], [200, 6], [280, 3], [330, 3]],
        stems: [{ x: 120, from: 72 }, { x: 200, from: 192 }, { x: 280, from: 120, beamTo: 330, beams: 1 }, { x: 330, from: 120, beams: 1, beamTo: 280 }],
      }),
    ).staves.find((s) => s.kind === 'tab')!
    expect(tab.barLines.map(Math.round)).toEqual([40, 400, 759])
    expect(tab.rhythm?.map((r) => r && r.duration)).toEqual([4, 4, 8, 8])
  })

  it('fills in a line hidden by digits', () => {
    const tab = detectTab(page({ digits, hideLine: 3 })).staves.find((s) => s.kind === 'tab')!
    expect(tab.lines).toHaveLength(6)
    expect(tab.numbers.find((n) => n.column === 0 && n.string === 4)).toBeTruthy()
  })
})

describe('tuplet bracket numbers', () => {
  const GLYPHS: Record<number, string[]> = {
    3: [' ######  ', '##    ## ', '      ## ', '      ## ', '     ##  ', '  ####   ', '     ##  ', '      ## ', '      ## ', '      ## ', '##    ## ', ' ######  ', '         '],
    5: ['######## ', '##       ', '##       ', '##       ', '######   ', '     ##  ', '      ## ', '      ## ', '      ## ', '##    ## ', ' ######  ', '         ', '         '],
    6: ['  #####  ', ' ##      ', '##       ', '##       ', '##       ', '## ####  ', '###   ## ', '##     ##', '##     ##', '##     ##', ' ##   ## ', '  #####  ', '         '],
  }
  /** A five-line staff (spacing 12) with "⌐— n —¬" brackets above it. */
  function staffPage(numbers: number[]): Gray {
    const width = 800
    const height = 300
    const data = new Uint8Array(width * height).fill(255)
    const set = (x: number, y: number, v = 40) => (data[y * width + x] = v)
    const lines = [150, 162, 174, 186, 198]
    for (const y of lines) for (let x = 40; x < 760; x++) set(x, y, 60)
    for (const bx of [40, 759]) for (let y = 150; y <= 198; y++) set(bx, y, 40)
    numbers.forEach((n, i) => {
      const cx = 160 + i * 200
      const top = 112
      GLYPHS[n].forEach((row, r) => [...row].forEach((c, k) => c === '#' && set(cx - 4 + k, top + r)))
      const cy = top + 6
      for (let x = cx - 50; x <= cx - 8; x++) set(x, cy)
      for (let x = cx + 8; x <= cx + 50; x++) set(x, cy)
      for (let y = cy; y <= cy + 8; y++) (set(cx - 50, y), set(cx + 50, y))
    })
    return { width, height, data }
  }

  it('reads the number on a bracket under the TAB rhythm (the digit wins over the stem count)', () => {
    // Six beamed eighths in measure 2, under a bracket marked "3" (two triplets written as one bracket).
    const xs = [440, 490, 540, 590, 640, 690]
    const g = page({ digits: xs.map((x) => [x, 3] as [number, number]), stems: xs.map((x) => ({ x, from: 120, beams: 1, beamTo: x === 690 ? 690 : x + 50 })) })
    const set = (x: number, y: number) => (g.data[y * g.width + x] = 30)
    const cy = 262
    for (let x = 430; x <= 545; x++) set(x, cy)
    for (let x = 585; x <= 700; x++) set(x, cy)
    GLYPHS[3].forEach((row, r) => [...row].forEach((c, k) => c === '#' && [0, 1].forEach((dx) => [0, 1].forEach((dy) => set(556 + k * 2 + dx, cy - 12 + r * 2 + dy)))))
    const tab = detectTab(g).staves.find((s) => s.kind === 'tab')!
    expect(tab.rhythm?.map((r) => r && [r.duration, r.tuplet ?? 0])).toEqual(xs.map(() => [8, 3]))
  })

  it('reads 3, 5 and 6 on the brackets', () => {
    const staff = detectTab(staffPage([3, 6, 5])).staves.find((s) => s.kind === 'staff')!
    expect(staff.tuplets).toHaveLength(3)
    expect(staff.tupletNumbers).toEqual([3, 6, 5])
  })
})
