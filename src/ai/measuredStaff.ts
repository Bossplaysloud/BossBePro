// Standard notation read by the program itself: the note heads, stems, beams, dots, accidentals
// and rests measured on the image (lib/noteHeads.ts) are laid out as the events of each measure.
// Where a measure adds up to its time signature, these events replace the AI's copy of it (the AI
// is unreliable at exact line/space positions and at counting beams); the AI's answer still gives
// what the program does not read: chord symbols, ties, time signature, tempo, fingering.

import { measureLength } from './rhythmFix'
import { eventLength, type StaffAnswer, type StaffEventAnswer, type StaffLayout } from './markedStaff'
import { trebleStepName, type NoteHead } from '../lib/noteHeads'
import type { Detection } from '../lib/tabDetect'

/** Events of each measure as measured, by measure number; a measure with nothing found is left out. */
export function measuredMeasures(d: Detection, layout: StaffLayout): Map<number, StaffEventAnswer[]> {
  const out = new Map<number, StaffEventAnswer[]>()
  for (const m of layout.measures) {
    const s = d.staves[m.staff]
    if (!s?.heads) continue
    const sp = s.spacing
    const inside = (x: number) => x > m.x0 + sp * 0.3 && x < m.x1 - sp * 0.3
    const heads = s.heads.filter((h) => inside(h.x))
    const rests = (s.rests ?? []).filter((r) => inside(r.x))
    if (!heads.length && !rests.length) continue
    // Heads on one stem make one event (a chord); stemless whole notes at one x too.
    const groups: NoteHead[][] = []
    for (const h of heads) {
      const g = groups.find((gr) => {
        const o = gr[0]
        if (h.stem && o.stem) return Math.abs(h.stem.x - o.stem.x) <= Math.max(2, sp * 0.15)
        return !h.stem && !o.stem && Math.abs(h.x - o.x) < sp * 0.6
      })
      if (g) g.push(h)
      else groups.push([h])
    }
    const bracketAt = (x: number) => (s.tuplets ?? []).findIndex(([a, b]) => x >= a - sp * 0.5 && x <= b + sp * 0.5)
    const events: { x: number; e: StaffEventAnswer }[] = groups.map((g) => {
      const top = g[0]
      const beams = Math.max(...g.map((h) => h.beams ?? 0))
      const value = !top.filled ? (top.stem ? '2' : '1') : (['4', '8', '16', '32'] as const)[Math.min(3, beams)]
      const x = g.reduce((a, h) => a + h.x, 0) / g.length
      return {
        x,
        e: {
          rest: false,
          chord: null,
          notes: [...g]
            .sort((a, b) => b.step - a.step) // lowest first
            .map((h) => ({ position: trebleStepName(h.step), accidental: h.accidental ?? 'none', tie: false, string: null, finger: null })),
          value,
          dots: Math.max(...g.map((h) => h.dots ?? 0)),
          tuplet: bracketAt(x),
          grace: false,
        },
      }
    })
    for (const r of rests) events.push({ x: r.x, e: { rest: true, chord: null, notes: [], value: String(r.value) as StaffEventAnswer['value'], dots: 0, tuplet: bracketAt(r.x), grace: false } })
    events.sort((a, b) => a.x - b.x)
    // The bracket's number as read on the image; when it could not be read, guessed from the notes
    // and rests under it (six → 6, five → 5, else 3). Either is checked against the measure length
    // when the measures are fused.
    const under = (k: number) => events.filter((o) => o.e.tuplet === k).length
    const counts = events.map((o) => (o.e.tuplet < 0 ? 0 : under(o.e.tuplet)))
    events.forEach((o, i) => {
      const read = o.e.tuplet < 0 ? 0 : (s.tupletNumbers?.[o.e.tuplet] ?? 0)
      o.e.tuplet = !counts[i] ? 0 : read || (counts[i] === 6 || counts[i] === 5 ? counts[i] : 3)
    })
    out.set(
      m.no,
      events.map((e) => e.e),
    )
  }
  return out
}

const parseTs = (t: string | null | undefined): [number, number] | null => {
  const s = (t ?? '').trim()
  if (s === 'C') return [4, 4]
  if (s === '¢') return [2, 2]
  const m = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(s)
  return m && [2, 4, 8, 16].includes(Number(m[2])) ? [Number(m[1]), Number(m[2])] : null
}

/** Onsets (32nds from the start of the measure) of a voice's events. */
function onsets(events: StaffEventAnswer[], ts: [number, number]) {
  const total = measureLength(ts)
  let t = 0
  return events.map((e) => {
    const at = t
    t += e.grace ? 0 : e.rest && e.value === '1' && !e.dots ? total : eventLength(e, ts)
    return at
  })
}

/**
 * The AI's answer with every measure that the program read completely (its events add up to the
 * time signature) replaced by the measured events. From the AI's copy of such a measure the
 * chord symbols, ties, fingering and string numbers are carried over, matched by time in the
 * measure (and by position for notes); an accidental the program missed is taken from the AI
 * when it gives one on the same line or space at the same time. Measures with two voices or a
 * repeat sign stay as the AI read them.
 */
export function fuseMeasured(a: StaffAnswer, measured: Map<number, StaffEventAnswer[]>, layout: StaffLayout, keySignature?: number): { answer: StaffAnswer; measured: number[]; fallback: number[] } {
  let ts = parseTs(a.timeSignature) ?? [4, 4]
  const used: number[] = []
  const fallback: number[] = []
  const measures = layout.measures.map((lm, index) => {
    const ans = a.measures?.find((x) => x.measure === lm.no) ?? { measure: lm.no, keySignature: null, timeSignature: null, repeatPrevious: false, voices: [] }
    const change = parseTs(ans.timeSignature)
    if (change) ts = change
    let ours = measured.get(lm.no)
    if (!ours || ans.repeatPrevious || (ans.voices ?? []).some((v) => v.voice === 2 && v.events?.some((e) => !e.rest))) {
      if (!ans.repeatPrevious) fallback.push(lm.no)
      return ans
    }
    const total = measureLength(ts)
    const sumOf = (evs: StaffEventAnswer[]) => onsets([...evs, { rest: true, notes: [], value: '4', dots: 0, tuplet: 0, grace: false }], ts).pop()!
    // Tuplet brackets found on the image are only trusted when the measure needs them to add up
    // (chord symbols and lines above the staff can look like brackets).
    // The number guessed for a bracket is kept when the measure adds up with it, else the tuplet that does.
    const plain = ours.map((e) => ({ ...e, tuplet: 0 }))
    const fits = (evs: StaffEventAnswer[]) => Math.abs(sumOf(evs) - total) < 1e-6
    if (ours.some((e) => e.tuplet)) {
      const guessed = ours
      ours = fits(plain) ? plain : ([guessed, ...[3, 6, 5].map((n) => guessed.map((e) => (e.tuplet ? { ...e, tuplet: n } : e)))].find(fits) ?? plain)
    }
    const sum = sumOf(ours)
    // A short first or last measure is a pickup when the AI's copy is just as short (otherwise
    // something was missed); any other measure must be full.
    const edge = index === 0 || index === layout.measures.length - 1
    const aiFirst = [...(ans.voices ?? [])].sort((x, y) => x.voice - y.voice)[0]?.events ?? []
    const aiSum = aiFirst.length ? onsets([...aiFirst, { rest: true, notes: [], value: '4', dots: 0, tuplet: 0, grace: false }], ts).pop()! : -1
    if (!(Math.abs(sum - total) < 1e-6 || (edge && sum > 0 && sum < total && Math.abs(aiSum - sum) < 1e-6))) {
      fallback.push(lm.no)
      return ans
    }
    const aiEvents = aiFirst
    const aiOn = onsets(aiEvents, ts)
    const ourOn = onsets(ours, ts)
    const nearest = (t: number) => {
      let best = 0
      ourOn.forEach((o, k) => {
        if (Math.abs(o - t) < Math.abs(ourOn[best] - t)) best = k
      })
      return best
    }
    const events = ours.map((e) => ({ ...e, notes: e.notes.map((n) => ({ ...n })) }))
    aiEvents.forEach((ae, k) => {
      if (ae.grace) return
      const target = events[nearest(aiOn[k])]
      if (ae.chord && !target.chord) target.chord = ae.chord
      for (const an of ae.notes ?? []) {
        // The same line or space at about the same time (the AI's timing may be a little off);
        // else, one note against one note at that time.
        let best: (typeof events)[number]['notes'][number] | null = null
        let gap = Infinity
        events.forEach((e, j) => {
          const d = Math.abs(ourOn[j] - aiOn[k])
          const n = e.notes.find((x) => x.position === an.position)
          if (n && d <= 8 && d < gap) {
            best = n
            gap = d
          }
        })
        const same: (typeof events)[number]['notes'][number] | null = best ?? (target.notes.length === 1 && ae.notes.length === 1 ? target.notes[0] : null)
        if (!same) continue
        if (an.tie && same.position === an.position) same.tie = true
        if (an.string) same.string = an.string
        if (an.finger != null) same.finger = an.finger
        if (same.accidental === 'none' && an.accidental !== 'none' && same.position === an.position) same.accidental = an.accidental
      }
    })
    used.push(lm.no)
    return { ...ans, repeatPrevious: false, voices: [{ voice: 1, events }] }
  })
  return { answer: { ...a, ...(keySignature ? { keySignature } : {}), measures }, measured: used, fallback }
}
