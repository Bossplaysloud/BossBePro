// Measures, beats and durations shared by every notation (TAB, staff, numbered).
// Content is generic over its note type; only notes differ between notations.

export type Duration = 1 | 2 | 4 | 8 | 16 | 32
export const DURATIONS: Duration[] = [1, 2, 4, 8, 16, 32]
export type Tuplet = 3 | 5 | 6
export const TUPLETS: Tuplet[] = [3, 5, 6]
export const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '2/2', '3/8', '5/8', '6/8', '7/8', '9/8', '12/8']

/** What every note type has: ties continue the previous note; dead notes have no pitch to tie. */
export interface BaseNote {
  tie?: boolean
  dead?: boolean
}

export interface Beat<N extends BaseNote = BaseNote> {
  id: string
  duration: Duration
  dotted?: boolean
  tuplet?: Tuplet
  /** A grace note: played just before the next beat and taking no time of its own. */
  grace?: boolean
  chord?: string // chord symbol shown above the beat; applies until the next chord
  lyric?: string // lyric syllable under the beat
  notes: N[] // empty = rest
}

export interface Measure<N extends BaseNote = BaseNote> {
  id: string
  /** Deliberately incomplete or long (e.g. a pickup bar): no length warning. */
  free?: boolean
  /** Time signature change starting at this measure (the sheet's signature applies before the first change). */
  timeSignature?: [number, number]
  beats: Beat<N>[]
  /** A second, independent voice on the same staff (e.g. the bass in classical guitar music). */
  voice2?: Beat<N>[]
}

export interface Content<N extends BaseNote = BaseNote> {
  kind: string
  version: 1
  measures: Measure<N>[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContent = Content<any>
type BeatOf<C extends AnyContent> = C['measures'][number]['beats'][number]

export interface Cursor {
  m: number // measure index
  b: number // beat index within measure
  s: number // string number (TAB) or 1
}

export const WHOLE = 3840 // ticks
export const uid = () => crypto.randomUUID()

const TUPLET_RATIO: Record<Tuplet, number> = { 3: 2 / 3, 5: 4 / 5, 6: 4 / 6 }

export function beatTicks(beat: Pick<Beat, 'duration' | 'dotted' | 'tuplet' | 'grace'>) {
  if (beat.grace) return 0
  return (WHOLE / beat.duration) * (beat.dotted ? 1.5 : 1) * (beat.tuplet ? TUPLET_RATIO[beat.tuplet] : 1)
}

export function measureCapacity([num, den]: [number, number]) {
  return (num * WHOLE) / den
}

export function measureTicks(measure: Pick<Measure, 'beats'>) {
  return measure.beats.reduce((t, b) => t + beatTicks(b), 0)
}

/** Negative = underfilled, positive = overfilled, 0 = exact. */
export function measureFill(measure: Pick<Measure, 'beats'>, ts: [number, number]) {
  return measureTicks(measure) - measureCapacity(ts)
}

const SHAPES: { ticks: number; duration: Duration; dotted?: boolean }[] = [
  { ticks: 3840, duration: 1 },
  { ticks: 2880, duration: 2, dotted: true },
  { ticks: 1920, duration: 2 },
  { ticks: 1440, duration: 4, dotted: true },
  { ticks: 960, duration: 4 },
  { ticks: 720, duration: 8, dotted: true },
  { ticks: 480, duration: 8 },
  { ticks: 360, duration: 16, dotted: true },
  { ticks: 240, duration: 16 },
  { ticks: 180, duration: 32, dotted: true },
  { ticks: 120, duration: 32 },
]

/** Splits a tick length into representable (possibly dotted) durations, longest first. */
export function splitTicks(ticks: number): { duration: Duration; dotted?: boolean }[] {
  const out: { duration: Duration; dotted?: boolean }[] = []
  let left = Math.round(ticks)
  while (left >= 120) {
    const shape = SHAPES.find((x) => x.ticks <= left)!
    out.push(shape.dotted ? { duration: shape.duration, dotted: true } : { duration: shape.duration })
    left -= shape.ticks
  }
  return out.length ? out : [{ duration: 32 }]
}

export function emptyBeat(duration: Duration = 4): Beat<never> {
  return { id: uid(), duration, notes: [] }
}

/** A measure filled with empty beats of one time-signature unit each (quarter notes in 4/4). */
export function emptyMeasure([num, den]: [number, number]): Measure<never> {
  const duration = (DURATIONS.includes(den as Duration) ? den : 4) as Duration
  return { id: uid(), beats: Array.from({ length: num }, () => emptyBeat(duration)) }
}

/** Time signature in effect at measure `m`: the latest change at or before it, else the sheet default. */
export function tsAt(c: AnyContent, m: number, base: [number, number]): [number, number] {
  for (let i = Math.min(m, c.measures.length - 1); i >= 0; i--) {
    const ts = c.measures[i].timeSignature
    if (ts) return ts
  }
  return base
}

/** Chord in effect at a beat: the latest chord symbol at or before it. */
export function chordAt(c: AnyContent, m: number, b: number): string | undefined {
  for (let i = m; i >= 0; i--) {
    const beats = c.measures[i]?.beats ?? []
    for (let j = i === m ? Math.min(b, beats.length - 1) : beats.length - 1; j >= 0; j--) {
      if (beats[j].chord) return beats[j].chord
    }
  }
  return undefined
}

export function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

// ---------- immutable edits ----------

export function updateBeat<C extends AnyContent>(c: C, m: number, b: number, fn: (beat: BeatOf<C>) => BeatOf<C>): C {
  return {
    ...c,
    measures: c.measures.map((mm, i) => (i !== m ? mm : { ...mm, beats: mm.beats.map((bb, j) => (j !== b ? bb : fn(bb))) })),
  }
}

export function cycleTuplet<C extends AnyContent>(c: C, m: number, b: number): C {
  return updateBeat(c, m, b, (beat) => {
    const i = beat.tuplet ? TUPLETS.indexOf(beat.tuplet) : -1
    const tuplet = TUPLETS[i + 1]
    const { tuplet: _old, ...rest } = beat
    void _old
    return tuplet ? { ...rest, tuplet } : rest
  })
}

export function setDuration<C extends AnyContent>(c: C, m: number, b: number, duration: Duration): C {
  return updateBeat(c, m, b, (beat) => ({ ...beat, duration }))
}

export function toggleDot<C extends AnyContent>(c: C, m: number, b: number): C {
  return updateBeat(c, m, b, (beat) => ({ ...beat, dotted: !beat.dotted }))
}

export function clearBeat<C extends AnyContent>(c: C, m: number, b: number): C {
  return updateBeat(c, m, b, (beat) => ({ ...beat, notes: [] }))
}

export function setChord<C extends AnyContent>(c: C, m: number, b: number, chord: string | null): C {
  return updateBeat(c, m, b, (beat) => {
    const { chord: _old, ...rest } = beat
    void _old
    return chord ? { ...rest, chord } : rest
  })
}

export function setLyric<C extends AnyContent>(c: C, m: number, b: number, lyric: string | null): C {
  return updateBeat(c, m, b, (beat) => {
    const { lyric: _old, ...rest } = beat
    void _old
    return lyric ? { ...rest, lyric } : rest
  })
}

/** Inserts an empty beat after `b` with the same duration. */
export function insertBeatAfter<C extends AnyContent>(c: C, m: number, b: number): C {
  const ref = c.measures[m].beats[b]
  const beat = emptyBeat(ref?.duration ?? 4)
  return {
    ...c,
    measures: c.measures.map((mm, i) => (i !== m ? mm : { ...mm, beats: [...mm.beats.slice(0, b + 1), beat, ...mm.beats.slice(b + 1)] })),
  }
}

/** Removes a beat; a measure always keeps at least one beat. */
export function deleteBeat<C extends AnyContent>(c: C, m: number, b: number): C {
  if (c.measures[m].beats.length <= 1) return clearBeat(c, m, b)
  return { ...c, measures: c.measures.map((mm, i) => (i !== m ? mm : { ...mm, beats: mm.beats.filter((_, j) => j !== b) })) }
}

/**
 * Sets (or with `null` removes) a time signature change at measure `m`. A measure that is still
 * empty is refilled with empty beats to match the new signature.
 */
export function setMeasureTs<C extends AnyContent>(c: C, m: number, ts: [number, number] | null, base: [number, number]): C {
  return {
    ...c,
    measures: c.measures.map((mm, i) => {
      if (i !== m) return mm
      const { timeSignature: _old, ...rest } = mm
      void _old
      const next: Measure = ts ? { ...rest, timeSignature: ts } : rest
      const empty = mm.beats.every((b) => b.notes.length === 0 && !b.chord && !b.lyric)
      if (!empty) return next
      const effective = ts ?? tsAt({ ...c, measures: c.measures.slice(0, m) }, m - 1, base)
      return { ...next, beats: emptyMeasure(effective).beats }
    }),
  }
}

export function insertMeasureAfter<C extends AnyContent>(c: C, m: number, ts: [number, number]): C {
  return { ...c, measures: [...c.measures.slice(0, m + 1), emptyMeasure(ts), ...c.measures.slice(m + 1)] }
}

/** Removes a measure; content always keeps at least one measure. */
export function deleteMeasure<C extends AnyContent>(c: C, m: number, ts: [number, number]): C {
  const measures = c.measures.filter((_, i) => i !== m)
  return { ...c, measures: measures.length ? measures : [emptyMeasure(ts)] }
}

export function clampCursor(c: AnyContent, cur: Cursor, strings: number): Cursor {
  const m = Math.max(0, Math.min(c.measures.length - 1, cur.m))
  const b = Math.max(0, Math.min(c.measures[m].beats.length - 1, cur.b))
  return { m, b, s: Math.max(1, Math.min(strings, cur.s)) }
}

/** Moves to the next/previous beat across measure boundaries. Returns null at either end. */
export function stepBeat(c: AnyContent, cur: Cursor, dir: 1 | -1): Cursor | null {
  let { m, b } = cur
  b += dir
  if (b >= c.measures[m].beats.length) {
    if (m + 1 >= c.measures.length) return null
    m++
    b = 0
  } else if (b < 0) {
    if (m === 0) return null
    m--
    b = c.measures[m].beats.length - 1
  }
  return { ...cur, m, b }
}

/** A stretch of beats: from (measure, beat) to (measure, beat), both included. */
export interface BeatSpan {
  from: { m: number; b: number }
  to: { m: number; b: number }
}

/**
 * The span of a custom range, kept inside the sheet; a missing beat means the whole measure.
 * The ends are put in order if given backwards.
 */
export function customSpan(r: { from: { m: number; b: number | null }; to: { m: number; b: number | null } }, total: number): BeatSpan {
  const clampM = (m: number) => Math.max(0, Math.min(Math.max(0, total - 1), m))
  let from = { m: clampM(r.from.m), b: r.from.b ?? 0 }
  let to = { m: clampM(r.to.m), b: r.to.b ?? Infinity }
  if (to.m < from.m || (to.m === from.m && to.b < from.b)) [from, to] = [{ m: to.m, b: r.to.b ?? 0 }, { m: from.m, b: r.from.b ?? Infinity }]
  return { from, to }
}

export function inSpan(span: BeatSpan | null | undefined, m: number, b: number) {
  if (!span) return true
  if (m < span.from.m || m > span.to.m) return false
  if (m === span.from.m && b < span.from.b) return false
  if (m === span.to.m && b > span.to.b) return false
  return true
}

/** The block of `size` measures containing measure `m` (size 0 = all). */
export function rangeFor(m: number, size: number, total: number): [number, number] {
  if (size <= 0) return [0, total]
  const start = Math.floor(m / size) * size
  return [start, Math.min(total, start + size)]
}

// ---------- fixing measure length ----------

const EPS = 1 // tuplets produce fractional ticks

/** Notes continuing into a split-off beat: same pitch/position, tied, without articulations. */
function tiedCopy<N extends BaseNote>(notes: N[]): N[] {
  return notes
    .filter((n) => !n.dead)
    .map((n) => {
      // Techniques belong to the attack, not to the continuation.
      const { legato, slide, bend, release, harmonic, palmMute, vibrato, letRing, ghost, dead, tap, ...identity } = n as N & Record<string, unknown>
      void [legato, slide, bend, release, harmonic, palmMute, vibrato, letRing, ghost, dead, tap]
      return { ...identity, tie: true } as unknown as N
    })
}

/** Empty beats covering `ticks`: up to the next beat-unit boundary, then one beat per unit (editable cells). */
function restBeats(ticks: number, unit = 960): Beat<never>[] {
  if (ticks < 120 - EPS) return []
  const partial = Math.round(ticks) % unit
  const out: Beat<never>[] = partial ? splitTicks(partial).map((sh) => ({ id: uid(), ...sh, notes: [] })) : []
  const unitShape = splitTicks(unit)[0]
  for (let k = 0; k < Math.floor(Math.round(ticks) / unit); k++) out.push({ id: uid(), ...unitShape, notes: [] })
  return out
}

const unitOf = (ts: [number, number]) => WHOLE / ts[1]

/** Splits a beat after `at` ticks. The remainder continues the sounding notes as ties. */
function splitBeat<B extends Beat>(beat: B, at: number): [B[], B[]] {
  const total = beatTicks(beat)
  const head = splitTicks(at).map((sh, k) => {
    const { tuplet: _t, chord, lyric, ...base } = beat
    void _t
    return k === 0
      ? ({ ...base, ...sh, ...(chord ? { chord } : {}), ...(lyric ? { lyric } : {}), dotted: sh.dotted } as B)
      : ({ id: uid(), ...sh, notes: tiedCopy(beat.notes) } as B)
  })
  const tail = splitTicks(total - at).map((sh) => ({ id: uid(), ...sh, notes: tiedCopy(beat.notes) }) as B)
  return [head.map(stripUndefined), tail]
}

/** Distributes beats over buckets of the given capacities, splitting beats that cross a boundary. */
function pack<B extends Beat>(beats: B[], next: () => [number, [number, number]]): B[][] {
  const out: B[][] = []
  let bucket: B[] = []
  let [left, ts] = next()
  const queue = [...beats]
  while (queue.length) {
    if (left <= EPS) {
      out.push(bucket)
      bucket = []
      ;[left, ts] = next()
    }
    const beat = queue.shift()!
    const len = beatTicks(beat)
    if (len <= left + EPS) {
      bucket.push(beat)
      left -= len
    } else if ((beat.tuplet || Math.abs(left - Math.round(left / 120) * 120) > EPS) && bucket.length) {
      // Tuplets (and split points no note value can express) are not cut: the whole beat moves on.
      queue.unshift(beat)
      bucket.push(...(restBeats(left, unitOf(ts)) as unknown as B[]))
      left = 0
    } else if (beat.tuplet) {
      bucket.push(beat) // longer than an empty measure: keep it whole
      left -= len
    } else {
      const [head, tail] = splitBeat(beat, left)
      bucket.push(...head)
      left = 0
      queue.unshift(...tail)
    }
  }
  out.push([...bucket, ...(restBeats(left, unitOf(ts)) as unknown as B[])])
  return out
}

/** Moves whatever does not fit into a new measure inserted right after (padded with rests). */
export function overflowToNewMeasure<C extends AnyContent>(c: C, m: number, base: [number, number]): C {
  const ts = tsAt(c, m, base)
  const [fit, ...rest] = pack(c.measures[m].beats, () => [measureCapacity(ts), ts])
  const extra: Measure[] = rest.map((beats) => ({ id: uid(), beats }))
  const measures = [...c.measures]
  measures.splice(m, 1, { ...c.measures[m], beats: fit }, ...extra)
  return { ...c, measures }
}

/** Drops whatever does not fit (a note crossing the bar line is shortened). */
export function trimToFit<C extends AnyContent>(c: C, m: number, base: [number, number]): C {
  const ts = tsAt(c, m, base)
  const [fit] = pack(c.measures[m].beats, () => [measureCapacity(ts), ts])
  return { ...c, measures: c.measures.map((mm, i) => (i === m ? { ...mm, beats: fit } : mm)) }
}

/** Pads an underfilled measure with rests. */
export function fillWithRests<C extends AnyContent>(c: C, m: number, base: [number, number]): C {
  const ts = tsAt(c, m, base)
  const missing = -measureFill(c.measures[m], ts)
  if (missing <= EPS) return c
  return { ...c, measures: c.measures.map((mm, i) => (i === m ? { ...mm, beats: [...mm.beats, ...restBeats(missing, unitOf(ts))] } : mm)) }
}

/**
 * Re-lays out every beat from measure `m` to the end so each measure is exactly full,
 * keeping each measure's time signature. Measures run out → new ones are added;
 * leftover empty measures (without their own time signature) are removed.
 */
export function reflowFrom<C extends AnyContent>(c: C, m: number, base: [number, number]): C {
  const tail: Measure[] = c.measures.slice(m)
  const beats = tail.flatMap((mm) => mm.beats)
  const isBlank = (b: Beat) => b.notes.length === 0 && !b.chord && !b.lyric
  while (beats.length && isBlank(beats[beats.length - 1])) beats.pop()
  let index = 0
  let ts = tsAt(c, m - 1, base)
  const shells: Measure[] = []
  const capacities = (): [number, [number, number]] => {
    const shell = tail[index] ?? { id: uid(), beats: [] }
    index++
    if (shell.timeSignature) ts = shell.timeSignature
    shells.push(shell)
    return [measureCapacity(ts), ts]
  }
  const buckets = pack(beats.length ? beats : [emptyBeat() as Beat], capacities)
  const laidOut = buckets.map((b, i) => ({ ...shells[i], beats: b }))
  // Keep later time-signature changes (filled with rests) so the rest of the song's meter is preserved.
  const kept = tail
    .slice(index)
    .filter((mm) => mm.timeSignature)
    .map((mm) => ({ ...mm, beats: restBeats(measureCapacity(mm.timeSignature!), unitOf(mm.timeSignature!)) }))
  return { ...c, measures: [...c.measures.slice(0, m), ...laidOut, ...kept] }
}

/** A time signature matching the measure's actual length (quarter, eighth or sixteenth based), if any. */
export function fittingTimeSignature(measure: Pick<Measure, 'beats'>): [number, number] | null {
  const total = measureTicks(measure)
  for (const den of [4, 8, 16]) {
    const num = total / (WHOLE / den)
    if (Math.abs(num - Math.round(num)) < 0.01 && Math.round(num) >= 1 && Math.round(num) <= 32) return [Math.round(num), den]
  }
  return null
}

/** Gives this measure a time signature that fits it; the following measure keeps the previous meter. */
export function fitTimeSignature<C extends AnyContent>(c: C, m: number, base: [number, number]): C {
  const ts = fittingTimeSignature(c.measures[m])
  if (!ts) return c
  const before = tsAt(c, m, base)
  return {
    ...c,
    measures: c.measures.map((mm, i) => {
      if (i === m) return { ...mm, timeSignature: ts }
      if (i === m + 1 && !mm.timeSignature && (before[0] !== ts[0] || before[1] !== ts[1])) return { ...mm, timeSignature: before }
      return mm
    }),
  }
}

/** Halves (factor 2: 1/4 → 1/8) or doubles (factor 0.5) every duration in the measure. Null if out of range. */
export function scaleMeasure<C extends AnyContent>(c: C, m: number, factor: 2 | 0.5): C | null {
  const beats = c.measures[m].beats.map((b) => ({ ...b, duration: (b.duration * factor) as Duration }))
  if (beats.some((b) => !DURATIONS.includes(b.duration))) return null
  return { ...c, measures: c.measures.map((mm, i) => (i === m ? { ...mm, beats } : mm)) }
}

export function toggleFree<C extends AnyContent>(c: C, m: number): C {
  return {
    ...c,
    measures: c.measures.map((mm, i) => {
      if (i !== m) return mm
      const { free, ...rest } = mm
      return free ? rest : { ...rest, free: true }
    }),
  }
}

// ---------- selections (whole beats, possibly across measures) ----------

export interface Pos {
  m: number
  b: number
}

export function comparePos(a: Pos, b: Pos) {
  return a.m - b.m || a.b - b.b
}

/** The two ends of a selection in reading order. */
export function orderRange(a: Pos, b: Pos): [Pos, Pos] {
  return comparePos(a, b) <= 0 ? [a, b] : [b, a]
}

export function inRange(p: Pos, [s, e]: [Pos, Pos]) {
  return comparePos(p, s) >= 0 && comparePos(p, e) <= 0
}

/** True when the range starts at a measure's first beat and ends at a measure's last beat. */
export function isWholeMeasures(c: AnyContent, [s, e]: [Pos, Pos]) {
  return s.b === 0 && e.b === c.measures[e.m].beats.length - 1
}

/** Copies of the beats in the range (fresh ids), in order. */
export function beatsInRange<C extends AnyContent>(c: C, [s, e]: [Pos, Pos]): BeatOf<C>[] {
  const out: BeatOf<C>[] = []
  for (let m = s.m; m <= e.m; m++) {
    const beats = c.measures[m].beats
    const from = m === s.m ? s.b : 0
    const to = m === e.m ? e.b : beats.length - 1
    for (let b = from; b <= to; b++) out.push(structuredClone({ ...beats[b], id: uid() }) as BeatOf<C>)
  }
  return out
}

/** Copies of whole measures in the range (fresh ids). */
export function measuresInRange<C extends AnyContent>(c: C, [s, e]: [Pos, Pos]): C['measures'] {
  return c.measures.slice(s.m, e.m + 1).map((mm) => structuredClone({ ...mm, id: uid(), beats: mm.beats.map((b) => ({ ...b, id: uid() })) })) as C['measures']
}

/** Removes the beats in the range. Measures left without beats are removed (content keeps at least one). */
export function removeRange<C extends AnyContent>(c: C, [s, e]: [Pos, Pos], ts: [number, number]): C {
  const measures = c.measures
    .map((mm, m) => {
      if (m < s.m || m > e.m) return mm
      return { ...mm, beats: mm.beats.filter((_, b) => !inRange({ m, b }, [s, e])) }
    })
    .filter((mm) => mm.beats.length > 0)
  return { ...c, measures: measures.length ? measures : [emptyMeasure(ts)] }
}

/** Clears the notes in the range but keeps the beats (rhythm), chords and lyrics. */
export function clearRange<C extends AnyContent>(c: C, [s, e]: [Pos, Pos]): C {
  return {
    ...c,
    measures: c.measures.map((mm, m) =>
      m < s.m || m > e.m ? mm : { ...mm, beats: mm.beats.map((bt, b) => (inRange({ m, b }, [s, e]) ? { ...bt, notes: [] } : bt)) },
    ),
  }
}

/** Inserts beats before position `at` (at.b may equal the measure length to append). */
export function insertBeatsAt<C extends AnyContent>(c: C, at: Pos, beats: Beat[]): C {
  const fresh = beats.map((b) => ({ ...structuredClone(b), id: uid() }))
  return {
    ...c,
    measures: c.measures.map((mm, m) => (m !== at.m ? mm : { ...mm, beats: [...mm.beats.slice(0, at.b), ...fresh, ...mm.beats.slice(at.b)] })),
  }
}

/** Inserts whole measures before measure `m` (m may equal the measure count to append). */
export function insertMeasuresAt<C extends AnyContent>(c: C, m: number, measures: Measure[]): C {
  const fresh = measures.map((mm) => ({ ...structuredClone(mm), id: uid(), beats: mm.beats.map((b) => ({ ...structuredClone(b), id: uid() })) }))
  return { ...c, measures: [...c.measures.slice(0, m), ...fresh, ...c.measures.slice(m)] }
}

/**
 * Replaces beats one by one starting at `at`, continuing into following measures. Beats that
 * run past the end are appended to the last measure. Returns the content and the last written position.
 */
export function overwriteAt<C extends AnyContent>(c: C, at: Pos, beats: Beat[]): { content: C; end: Pos } {
  const measures = c.measures.map((mm) => ({ ...mm, beats: [...mm.beats] }))
  let pos: Pos = { ...at }
  let end = at
  for (const beat of beats) {
    const copy = { ...structuredClone(beat), id: uid() }
    if (pos.m >= measures.length) {
      const last = measures[measures.length - 1]
      last.beats.push(copy)
      end = { m: measures.length - 1, b: last.beats.length - 1 }
      continue
    }
    measures[pos.m].beats[pos.b] = copy
    end = pos
    pos = pos.b + 1 < measures[pos.m].beats.length ? { m: pos.m, b: pos.b + 1 } : { m: pos.m + 1, b: 0 }
  }
  return { content: { ...c, measures }, end }
}
