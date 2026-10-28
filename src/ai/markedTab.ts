// TAB recognition where the app locates everything and the AI only reads.
//
// The detector (lib/tabDetect) finds the TAB lines, bar lines and every fret number with its
// string and column. The image is sent with a thin box around each number and a column number
// under the TAB ("set-of-mark" prompting), and the AI answers two questions only: what is written
// in each box, and the rhythm of each measure. Strings and columns come from the measurement, so
// the AI cannot move a note to another string or invent one.

import { fixTuplets, measureLength, reflowBySpacing } from './rhythmFix'
import { TECHNIQUES, tupletOf, tupletRatio, type Recognition, type RecognizedBeat, type RecognizedTabNote, type TechniqueName } from './schema'
import { TUPLETS } from '../music/rhythm'
import type { Box, ColumnRhythm, Detection } from '../lib/tabDetect'

export interface MarkedColumn {
  id: number // 1-based, as drawn under the TAB
  staff: number // index into the detection's staves
  x: number
  /** Rhythm the app measured under the TAB for this column, when printed there. */
  rhythm?: ColumnRhythm
  /** All its numbers are printed small: a grace note. */
  grace?: boolean
  /**
   * Under a tuplet bracket in the staff above (measured): its number as guessed from the columns
   * under it (6 over six columns, else 3); 0 when that staff has none here.
   */
  tuplet?: number
  /** Older form of `tuplet` (true = 3), still read when `tuplet` is absent. */
  triplet?: boolean
  boxes: { string: number; box: Box; uncertain?: boolean; link?: 'arc' | 'slide' | 'slideOut'; linkTo?: number }[]
}

export interface MarkedMeasure {
  no: number // 1-based within the image
  columns: number[] // column ids, left to right
  x0: number
  x1: number
}

export interface MarkedLayout {
  strings: number
  columns: MarkedColumn[]
  measures: MarkedMeasure[]
}

/** Measures and columns of every TAB staff, in reading order. */
export function layoutFromDetection(d: Detection): MarkedLayout | null {
  const tabs = d.staves.filter((s) => s.kind === 'tab' && s.numbers.length)
  if (!tabs.length) return null
  const columns: MarkedColumn[] = []
  const measures: MarkedMeasure[] = []
  for (const s of tabs) {
    const staffIndex = d.staves.indexOf(s)
    // Measure bounds: the bar lines, plus the ends of the staff where no bar line is drawn.
    const bounds = [...s.barLines].sort((a, b) => a - b)
    if (!bounds.length || bounds[0] > s.x0 + s.spacing * 3) bounds.unshift(s.x0)
    if (bounds[bounds.length - 1] < s.x1 - s.spacing * 3) bounds.push(s.x1)
    const bracketOf = new Map<MarkedColumn, number>()
    const ids = s.columns.flatMap((x) => {
      // Slide strokes and arc pieces are not numbers: they are not sent to be read.
      const inColumn = s.numbers.filter((n) => s.columns[n.column] === x && !n.stroke)
      if (!inColumn.length) return []
      // One box per string: a second one on the same string is a stray mark next to the number.
      type Mark = MarkedColumn['boxes'][number]
      const byString = new Map<number, Mark>()
      for (const n of inColumn) {
        const prev = byString.get(n.string)
        const dist = (b: Box) => Math.abs((b.x0 + b.x1) / 2 - x)
        if (!prev || dist(n.box) < dist(prev.box)) byString.set(n.string, { string: n.string, box: n.box, ...(n.uncertain ? { uncertain: true } : {}), ...(n.link ? { link: n.link } : {}), ...(n.linkTo !== undefined ? { linkTo: n.linkTo } : {}) })
      }
      const rhythm = s.rhythm?.[s.columns.indexOf(x)]
      const grace = inColumn.every((n) => n.small)
      // The staff printed right above this TAB (same system) and its tuplet brackets.
      const above = d.staves[staffIndex - 1]
      const sameSystem = above?.kind === 'staff' && s.lines[0] - above.lines[above.lines.length - 1] <= s.spacing * 14
      const bracket = sameSystem && above.tuplets ? above.tuplets.findIndex(([a, b]) => x >= a - s.spacing * 0.3 && x <= b + s.spacing * 0.3) : undefined
      const column: MarkedColumn = { id: columns.length + 1, staff: staffIndex, x, boxes: [...byString.values()].sort((a, b) => a.string - b.string), ...(rhythm ? { rhythm } : {}), ...(grace ? { grace } : {}) }
      if (bracket !== undefined) bracketOf.set(column, bracket)
      columns.push(column)
      return [column]
    })
    // The bracket's number as read on the staff above; when it could not be read, six columns under
    // one bracket make a sextuplet, others a triplet.
    for (const [c, k] of bracketOf) {
      const read = k < 0 ? 0 : (d.staves[c.staff - 1]?.tupletNumbers?.[k] ?? 0)
      c.tuplet = k < 0 ? 0 : read || ([...bracketOf].filter(([o, j]) => j === k && !o.grace).length === 6 ? 6 : 3)
    }
    for (let i = 0; i + 1 < bounds.length; i++) {
      if (bounds[i + 1] - bounds[i] < s.spacing * 2) continue
      const inside = ids.filter((c) => c.x > bounds[i] && c.x < bounds[i + 1]).map((c) => c.id)
      measures.push({ no: measures.length + 1, columns: inside, x0: bounds[i], x1: bounds[i + 1] })
    }
  }
  // Links point at a column of the same staff by its index there; turn that into the column id.
  for (const c of columns) {
    const staff = d.staves[c.staff]
    for (const b of c.boxes) {
      if (b.linkTo === undefined) continue
      const x = staff.columns[b.linkTo]
      b.linkTo = columns.find((o) => o.staff === c.staff && o.x === x)?.id
    }
  }
  return { strings: Math.max(...tabs.map((s) => s.lines.length)), columns, measures }
}

/** The image to send: enlarged when the print is small, with a box around each number and column numbers. */
export function markImage(src: HTMLCanvasElement, d: Detection, layout: MarkedLayout): HTMLCanvasElement {
  const tabs = d.staves.filter((s) => s.kind === 'tab')
  const spacing = Math.min(...tabs.map((s) => s.spacing))
  const f = Math.max(1, Math.min(20 / spacing, 2400 / Math.max(src.width, src.height)))
  const out = document.createElement('canvas')
  out.width = Math.round(src.width * f)
  out.height = Math.round(src.height * f)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, out.width, out.height)
  // A faint dashed guide from each column up through the staff above it: the staff notes on the
  // guide are that column's notes, so their rhythm can be read for it.
  ctx.strokeStyle = 'rgba(229, 57, 53, 0.45)'
  ctx.lineWidth = Math.max(1, f * 0.8)
  ctx.setLineDash([4 * f, 3 * f])
  for (const c of layout.columns) {
    const tab = d.staves[c.staff]
    const above = d.staves[c.staff - 1]
    if (!above || above.kind !== 'staff' || tab.lines[0] - above.lines[above.lines.length - 1] > tab.spacing * 14) continue
    ctx.beginPath()
    ctx.moveTo(c.x * f, (tab.lines[0] - tab.spacing * 0.5) * f)
    ctx.lineTo(c.x * f, (above.lines[0] - above.spacing * 1.5) * f)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.strokeStyle = 'rgba(229, 57, 53, 0.9)'
  ctx.lineWidth = Math.max(1, f * 0.6)
  for (const c of layout.columns) for (const { box } of c.boxes) ctx.strokeRect((box.x0 - 1.5) * f, (box.y0 - 1.5) * f, (box.x1 - box.x0 + 3) * f, (box.y1 - box.y0 + 3) * f)
  ctx.fillStyle = '#e53935'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const c of layout.columns) {
    const s = d.staves[c.staff]
    ctx.font = `bold ${Math.round(s.spacing * f * 0.9)}px sans-serif`
    ctx.fillText(String(c.id), c.x * f, (s.lines[s.lines.length - 1] + s.spacing * 0.8) * f)
  }
  return out
}

const DURATIONS = ['1', '2', '4', '8', '16', '32'] as const

/** Marks printed at a boxed number: bend (with its amount when written), vibrato, harmonics, tapping. */
export const NOTE_MARKS = ['bend', 'bendHalf', 'bendFull', 'bend1Half', 'bend2', 'release', 'vibrato', 'harmonic', 'artificialHarmonic', 'tap'] as const
export type NoteMark = (typeof NOTE_MARKS)[number]
const BEND_MARKS: Partial<Record<NoteMark, number>> = { bendHalf: 0.5, bendFull: 1, bend1Half: 1.5, bend2: 2 }

export const MARKED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'tempo', 'timeSignature', 'key', 'capo', 'tuning', 'columns', 'measures', 'warnings'],
  properties: {
    title: { type: ['string', 'null'] },
    tempo: { type: ['integer', 'null'] },
    timeSignature: { type: ['string', 'null'], description: 'Starting time signature, e.g. "6/8"' },
    key: { type: ['string', 'null'], description: 'Key from the key signature, e.g. "Bb"' },
    capo: { type: ['integer', 'null'] },
    tuning: { type: ['array', 'null'], items: { type: 'string' }, description: 'Only if written, lowest string first, e.g. ["D2","A2","D3","G3","B3","E4"]' },
    columns: {
      type: 'array',
      description: 'Every numbered column, in order',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'notes'],
        properties: {
          id: { type: 'integer', description: 'The red column number under the TAB' },
          notes: {
            type: 'array',
            description: 'One entry per box of the column, top to bottom, on the strings given in the list',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['string', 'text', 'technique', 'marks'],
              properties: {
                string: { type: 'integer' },
                text: { type: 'string', description: 'What is written in the box: "3", "12", "x" (dead note), "(5)" (ghost), "<12>" (harmonic); "" when the box holds no fret number' },
                technique: { type: 'string', enum: ['none', ...TECHNIQUES], description: 'Technique starting at this note: hammer (H / h or an arc to a higher number), pull (P / p or an arc to a lower number), slide (/ \\ or sl.), bend, vibrato (~), palmMute (P.M.), letRing (let ring)' },
                marks: { type: 'array', items: { type: 'string', enum: [...NOTE_MARKS] }, description: 'Other marks printed at this number: bendHalf ("½" / "1/2" at a bend arrow), bendFull ("full"), bend1Half ("1½"), bend2 ("2"), bend (b or a bend arrow, amount not written), release (r or an arrow back down), vibrato (~ or a wavy line), harmonic (<12>, "N.H.", "Harm."), artificialHarmonic ("A.H.", "P.H.", "T.H."), tap ("T" or "tap" over the number); [] when none' },
              },
            },
          },
        },
      },
    },
    measures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['measure', 'timeSignature', 'events'],
        properties: {
          measure: { type: 'integer' },
          timeSignature: { type: ['string', 'null'], description: 'Only when it changes at this measure' },
          events: {
            type: 'array',
            description: 'Left to right: each column of the measure once, plus rests and tied continuations',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'column', 'duration', 'dotted', 'tuplet'],
              properties: {
                type: { type: 'string', enum: ['column', 'rest', 'tie'], description: 'column = the notes of a column are played; rest = a rest; tie = the previous notes are held (a tied note with no new TAB number)' },
                column: { type: ['integer', 'null'], description: 'The column number for type "column"' },
                duration: { type: 'string', enum: [...DURATIONS], description: '1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth, 32 thirty-second' },
                dotted: { type: 'boolean' },
                tuplet: { type: 'integer', description: 'The number on the tuplet bracket over this note: 3 (triplet), 6 (sextuplet), 5; 0 when there is none' },
              },
            },
          },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
}

export interface MarkedAnswer {
  title: string | null
  tempo: number | null
  timeSignature: string | null
  key: string | null
  capo: number | null
  tuning: string[] | null
  columns: { id: number; notes: { string: number; text: string; technique: 'none' | TechniqueName; marks?: NoteMark[] }[] }[]
  measures: { measure: number; timeSignature: string | null; events: { type: 'column' | 'rest' | 'tie'; column: number | null; duration: RecognizedBeat['duration']; dotted: boolean; tuplet?: number; triplet?: boolean }[] }[]
  warnings: string[]
}

export function buildMarkedPrompt(layout: MarkedLayout, opts: { language: 'zh-TW' | 'en'; context?: string }) {
  const lang = opts.language === 'zh-TW' ? 'Traditional Chinese (繁體中文)' : 'English'
  const columns = layout.columns
    .map((c) => `c${c.id}: strings ${c.boxes.map((b) => b.string).join(', ')}${c.grace ? ' (small numbers: a grace note)' : ''}${colTuplet(c) ? ' (under a tuplet bracket)' : ''}`)
    .join('\n')
  const measures = layout.measures.map((m) => `m${m.no}: ${m.columns.length ? m.columns.map((c) => `c${c}`).join(' ') : '(no columns)'}`).join('\n')
  return [
    'This image is guitar tablature (TAB), possibly with a standard staff above each TAB. String 1 is the top TAB line.',
    'I have already located every fret number: each has a thin red box, and each column of numbers has a red column number printed under the TAB. Trust these marks: do not look for other numbers and do not move numbers to other strings or columns.',
    '',
    '1. Columns: for every column below, read what is written in each of its boxes, on the strings given, top to bottom. Copy it exactly ("3", "12"); "x" for a dead note, "(5)" for a ghost note, "<12>" or "12" with "N.H."/"Harm." for a harmonic, "" if the box holds no fret number. Technique starting at that note: bend (b, or a curved arrow up with "full", "1/2"), release (r), vibrato (~ or a wavy line), palmMute (P.M. with a dashed line over it), letRing (let ring with a dashed line), harmonic; list in "marks" the bend amount ("½", "full"), vibrato, harmonic ("N.H." / "A.H.") and tapping ("T") printed at that number; for an arc with H or P, or a slide (sl., / or \\), just say hammer, pull or slide — the app measures these itself; otherwise "none".',
    '2. Measures: for every measure below, give its rhythm left to right as events: one "column" event for each of its columns, in order, each exactly once; a "rest" event where the rhythm shows a rest; a "tie" event where a note is held on from the previous one with no new TAB number (a curved tie in the staff), meaning the previous notes are held.',
    '   Where to read the rhythm: if a staff is printed above the TAB, a faint red dashed line runs from each column up through it — the staff note or chord on that line belongs to that column; take the value from its head, stem, flags, beams and dots. Staff notes with no line through them are rests or tied notes (tie events). If the rhythm is printed under the TAB instead (stems hanging below the numbers), read it there: a stem alone = quarter, a shorter or hollow-headed stem = half, no stem = whole, one beam or flag = eighth, two = sixteenth, three = thirty-second, a dot beside the stem adds half, and rest symbols between stems are rests.',
    '   Values: tuplet = the number printed on the bracket (3 triplet, 6 sextuplet, 5) for exactly the notes under it, 0 otherwise; six sixteenths under a "6" are one sextuplet (6), not two triplets. In 6/8, 9/8 and 12/8 the eighths are beamed in threes (one beat = three eighths). The events of each measure must add up to the time signature (6/8 = six eighths, 3/4 = three quarters); a short first measure is a pickup.',
    '3. Copy the title, tempo, time signature, key, capo (e.g. "Capo fret 3" → 3) and tuning when written.',
    layout.columns.some((c) => c.rhythm) ? 'The app has already measured the rhythm printed under the TAB; still list every column in order, and add the rests and tied notes you see.' : '',
    opts.context ?? '',
    '',
    'Columns (number: strings of its boxes):',
    columns,
    '',
    'Measures (number: its columns):',
    measures,
    '',
    `Write warnings in ${lang}.`,
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
}

/**
 * Hammer-ons, pull-offs, ties and slides from what the app measured between two numbers on the same
 * string: an arc to a higher fret is a hammer-on, to a lower fret a pull-off, to the same fret a tie;
 * a slanted stroke is a slide. These replace the AI's guesses; an H or P the AI saw with no arc
 * measured is kept but turned the right way by the two frets.
 */
export function linkNotes(played: { column: number; notes: RecognizedTabNote[]; grace?: boolean }[], layout: MarkedLayout) {
  // Marked last, once every note and value is settled, and only from what was measured on the page:
  // the AI's own H / P guesses are not used. An arc to a higher fret is a hammer-on, to a lower fret
  // a pull-off, to the same fret a tie; a slanted stroke is a slide ("sl." printed with an arc as
  // well counts as a slide when the AI read it); a stroke with nothing after it is a slide out.
  const LEGATO: TechniqueName[] = ['hammer', 'pull', 'slide', 'slideOut']
  for (const p of played) {
    const col = layout.columns[p.column - 1]
    for (const n of p.notes) {
      const aiSlide = n.techniques.includes('slide')
      n.techniques = n.techniques.filter((t) => !LEGATO.includes(t))
      if (n.dead || n.fret === null) continue
      const box = col?.boxes.find((b) => b.string === n.string)
      if (!box?.link) continue
      if (box.link === 'slideOut') {
        if (!p.grace) n.techniques.push('slideOut')
        continue
      }
      // The note the measured arc or stroke goes to.
      const next = played.find((q) => q.column === box.linkTo)?.notes.find((m) => m.string === n.string)
      if (!next || next.fret === null || next.dead) continue
      if (box.link === 'slide' || aiSlide) n.techniques.push('slide')
      // A grace note runs into its main note anyway: no H / P on the small note.
      else if (p.grace) continue
      else if (next.fret > n.fret) n.techniques.push('hammer')
      else if (next.fret < n.fret) n.techniques.push('pull')
      else next.tie = true
    }
  }
}

/** "3", "12", "x", "(5)", "<12>" plus the marks printed at it → a TAB note; null when the box held no fret number. */
export function readNote(string: number, text: string, technique: string, marks: readonly string[] = []): RecognizedTabNote | null {
  const t = text.normalize('NFKC').trim()
  const techniques: TechniqueName[] = (TECHNIQUES as readonly string[]).includes(technique) ? [technique as TechniqueName] : []
  if (/^[xX×]$/.test(t)) return { string, fret: null, dead: true, tie: false, techniques: [] }
  const m = /^([(<]?)(\d{1,2})([)>]?)$/.exec(t)
  if (!m) return null
  if (m[1] === '(') techniques.push('ghost')
  if (m[1] === '<') techniques.push('harmonic')
  const note: RecognizedTabNote = { string, fret: Number(m[2]), dead: false, tie: false, techniques }
  // Bend, vibrato, harmonic and tapping marks printed at the number (H / P / slides come from the measured arcs).
  const add = (x: TechniqueName) => techniques.includes(x) || techniques.push(x)
  for (const mark of marks as NoteMark[]) {
    if (mark === 'bend' || BEND_MARKS[mark]) add('bend')
    if (BEND_MARKS[mark]) note.bend = BEND_MARKS[mark]
    if (mark === 'release') add('release')
    if (mark === 'vibrato') add('vibrato')
    if (mark === 'harmonic' || mark === 'artificialHarmonic') add('harmonic')
    if (mark === 'artificialHarmonic') note.harmonic = 'artificial'
    if (mark === 'tap') note.tap = true
  }
  return note
}

const parseTs = (text: string | null | undefined): [number, number] | null => {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(text ?? '')
  return m && [2, 4, 8, 16].includes(Number(m[2])) ? [Number(m[1]), Number(m[2])] : null
}

const played = (b: RecognizedBeat) => (b.grace ? 0 : (32 / Number(b.duration)) * (b.dotted ? 1.5 : 1) * tupletRatio(tupletOf(b)))

/** A column's measured tuplet: 0 outside a bracket, undefined when nothing was measured. */
const colTuplet = (c?: MarkedColumn) => c?.tuplet ?? (c?.triplet === undefined ? undefined : c.triplet ? 3 : 0)

/** The tuplet number the AI read for an event, when it is one the editor has. */
const aiTuplet = (e?: Pick<RecognizedBeat, 'tuplet' | 'triplet'>) => {
  const n = e ? tupletOf(e) : 0
  return (TUPLETS as number[]).includes(n) ? n : 0
}

/** A measured bracket decides whether a note is a tuplet; its number is the AI's reading when it gave one. */
const decideTuplet = (measured: number | undefined, e?: Pick<RecognizedBeat, 'tuplet' | 'triplet'>) => (measured === undefined ? aiTuplet(e) : measured ? aiTuplet(e) || measured : 0)

const blankBeat = (duration: RecognizedBeat['duration'] = '8'): RecognizedBeat => ({ duration, dotted: false, tuplet: 0, chord: null, lyric: null, tab: [], pitch: null, degree: null, tie: false, x: null })

/**
 * Builds the transcription from the AI's answer and the measured layout. Measures whose rhythm
 * does not add up are re-timed from the column spacing (engraved spacing grows about √2 per
 * doubling of the note value, so the value is taken as proportional to the square of the space).
 */
export function markedToRecognition(a: MarkedAnswer, layout: MarkedLayout): Recognition {
  const warnings = [...(a.warnings ?? [])]
  const notesOf = new Map((a.columns ?? []).map((c) => [c.id, c.notes]))
  let ts = parseTs(a.timeSignature) ?? [4, 4]
  const reflowed: number[] = []
  const wrong: number[] = []
  // Every played column in order, to join notes by the arcs and slides the app measured.
  const sequence: { column: number; notes: RecognizedTabNote[]; grace?: boolean }[] = []
  const edges: { index: number; no: number; have: number; total: number; out: { beats: RecognizedBeat[] }; retime: (bs: RecognizedBeat[]) => RecognizedBeat[] | null }[] = []
  const measures = layout.measures.map((m, mi) => {
    const answer = a.measures?.find((x) => x.measure === m.no)
    const change = parseTs(answer?.timeSignature)
    if (change) ts = change
    // The AI's events, keeping each of this measure's columns once and in order.
    const seen = new Set<number>()
    type Ev = { beat: RecognizedBeat; x: number | null; known: boolean; measured?: boolean }
    const events: Ev[] = []
    let last: RecognizedTabNote[] = []
    const columnEvent = (id: number, e?: MarkedAnswer['measures'][number]['events'][number]): Ev | null => {
      const col = layout.columns[id - 1]
      const read = notesOf.get(id) ?? []
      const tab = col.boxes.flatMap(({ string }) => {
        const r = read.find((n) => n.string === string)
        const note = r ? readNote(string, r.text, r.technique, r.marks) : null
        return note ? [note] : []
      })
      if (!tab.length) return null
      last = tab
      sequence.push({ column: id, notes: tab, ...(col.grace ? { grace: true } : {}) })
      // Small numbers are grace notes: they take no time.
      if (col.grace) return { beat: { ...blankBeat(e?.duration === '16' || e?.duration === '32' ? e.duration : '8'), grace: true, tab }, x: col.x, known: true, measured: true }
      // Rhythm measured under the TAB wins over what the AI read.
      const r = col.rhythm
      if (r) return { beat: { ...blankBeat(String(r.duration) as RecognizedBeat['duration']), dotted: r.dotted, tuplet: decideTuplet(r.tuplet ?? (r.triplet ? 3 : 0), e), tab }, x: col.x, known: true, measured: true }
      // A tuplet bracket measured in the staff above decides whether the note is a tuplet.
      return { beat: { ...blankBeat(e?.duration ?? '8'), dotted: !!e?.dotted, tuplet: decideTuplet(colTuplet(col), e), tab }, x: col.x, known: !!e }
    }
    for (const e of answer?.events ?? []) {
      if (e.type === 'column') {
        if (e.column == null || !m.columns.includes(e.column) || seen.has(e.column)) continue
        // A column the AI skipped goes back in its place, before this one.
        for (const missing of m.columns.filter((c) => c < e.column! && !seen.has(c))) {
          seen.add(missing)
          const ev = columnEvent(missing)
          if (ev) events.push(ev)
        }
        seen.add(e.column)
        const ev = columnEvent(e.column, e)
        if (ev) events.push(ev)
      } else if (e.type === 'tie' && last.length) {
        events.push({ beat: { ...blankBeat(e.duration), dotted: e.dotted, tuplet: aiTuplet(e), tab: last.map((n) => ({ ...n, tie: true, techniques: [] })) }, x: null, known: true })
      } else if (e.type === 'rest') {
        events.push({ beat: { ...blankBeat(e.duration), dotted: e.dotted, tuplet: aiTuplet(e) }, x: null, known: true })
      }
    }
    for (const missing of m.columns.filter((c) => !seen.has(c))) {
      const ev = columnEvent(missing)
      if (ev) events.push(ev)
    }
    // Rests and held notes between two columns under the same bracket (or both outside one) follow them.
    events.forEach((ev, i) => {
      if (ev.x != null || ev.beat.grace) return
      const prev = [...events.slice(0, i)].reverse().find((o) => o.x != null && !o.beat.grace)
      const next = events.slice(i + 1).find((o) => o.x != null && !o.beat.grace)
      const t = (o?: Ev) => (o ? colTuplet(layout.columns.find((c) => c.x === o.x)) : undefined)
      if (t(prev) !== undefined && t(next) !== undefined && !t(prev) === !t(next)) ev.beat = { ...ev.beat, tuplet: t(prev) ? tupletOf(prev!.beat) : 0 }
    })
    let beats = fixTuplets(events.map((e) => e.beat)).beats
    const total = measureLength(ts)
    // Measured rhythm one value short (a half drawn like a quarter, a missing dot): lengthen the note
    // that has the most room for its value.
    const short = total - beats.reduce((t, b) => t + played(b), 0)
    if (short > 1e-6 && mi > 0 && events.length && events.every((e) => e.measured || !e.x)) {
      const room = events.map((e, i) => {
        const nextX = events.slice(i + 1).find((o) => o.x != null)?.x ?? m.x1
        return e.x != null && e.measured ? (nextX - e.x) / played(beats[i]) : -1
      })
      const fits = beats
        .map((b, i) => ({ i, b }))
        .filter(({ b, i }) => room[i] > 0 && !tupletOf(b) && ((Number(b.duration) >= 2 && Math.abs(played(b) - short) < 1e-6) || (!b.dotted && Math.abs(played(b) / 2 - short) < 1e-6)))
        .sort((a, b) => room[b.i] - room[a.i])[0]
      if (fits) {
        const b = fits.b
        const longer = Math.abs(played(b) - short) < 1e-6 ? { duration: String(Number(b.duration) / 2) as RecognizedBeat['duration'] } : { dotted: true }
        beats = beats.map((x, i) => (i === fits.i ? { ...x, ...longer } : x))
      }
    }
    const have = beats.reduce((t, b) => t + played(b), 0)
    // Re-times the measure from the column spacing.
    const retime = (bs: RecognizedBeat[]): RecognizedBeat[] | null => {
      // Positions for rests and ties: halfway between their neighbours.
      const xs = events.map((e) => e.x)
      for (let i = 0; i < xs.length; i++) {
        if (xs[i] != null) continue
        const before = [...xs.slice(0, i)].reverse().find((x) => x != null) ?? m.x0
        const after = xs.slice(i + 1).find((x) => x != null) ?? m.x1
        xs[i] = (before! + after!) / 2
      }
      // Square the gaps: note values grow about with the square of the space they take.
      const pseudo: number[] = [0]
      for (let i = 1; i < xs.length; i++) pseudo.push(pseudo[i - 1] + (xs[i]! - xs[i - 1]!) ** 2)
      const end = pseudo[pseudo.length - 1] + (m.x1 - xs[xs.length - 1]!) ** 2
      // Grace notes keep their small value and take no time; the others share the measure.
      const timed = bs.map((b, i) => ({ ...b, x: pseudo[i] })).filter((b) => !b.grace)
      const retimed = reflowBySpacing({ timeSignature: null, beats: timed, start: null, end }, total)
      return retimed && bs.map((b) => (b.grace ? b : retimed.shift()!))
    }
    const out = { timeSignature: change ? `${change[0]}/${change[1]}` : null, beats, start: null, end: null }
    // A short first or last measure may be a pickup; that is decided once both are known.
    const edge = (mi === 0 || mi === layout.measures.length - 1) && have < total && events.every((e) => e.known)
    if (edge) edges.push({ index: mi, no: m.no, have, total, out, retime })
    else if (beats.length && (Math.abs(have - total) > 1e-6 || events.some((e) => !e.known))) {
      const fixed = retime(beats)
      if (fixed) {
        out.beats = fixed
        reflowed.push(m.no)
      } else wrong.push(m.no)
    }
    return out
  })
  // A real pickup: the short first measure and the short last one make one full measure together
  // (or the first is short and the last is full). Anything else short was misread: re-time it.
  const first = edges.find((x) => x.index === 0)
  const last = edges.find((x) => x.index === layout.measures.length - 1 && x.index !== 0)
  const lastFull = !last && layout.measures.length > 1
  const pickup = first && ((last && Math.abs(first.have + last.have - first.total) < 1e-6) || (lastFull && first.have <= first.total / 2))
  for (const x of edges) {
    if (pickup && (x === first || x === last)) continue
    const fixed = x.retime(x.out.beats)
    if (fixed) {
      x.out.beats = fixed
      reflowed.push(x.no)
    } else wrong.push(x.no)
  }
  for (const m of measures) m.beats = m.beats.map((b) => ({ ...b, x: null }))
  reflowed.sort((a, b) => a - b)
  linkNotes(sequence, layout)
  const unsure = layout.columns.flatMap((c) => c.boxes.filter((b) => b.uncertain && notesOf.get(c.id)?.some((n) => n.string === b.string && n.text.trim())))
  if (unsure.length) warnings.push(`uncertainString:${unsure.length}`)
  if (reflowed.length) warnings.push(`reflowed:${reflowed.join(', ')}`)
  if (wrong.length) warnings.push(`lengthWrong:${wrong.join(', ')}`)
  return {
    notation: 'tab',
    title: a.title,
    strings: layout.strings,
    tuning: a.tuning?.length === layout.strings ? a.tuning : null,
    key: a.key,
    timeSignature: a.timeSignature,
    tempo: a.tempo,
    capo: a.capo,
    measures,
    chart: { originalKey: null, writtenKey: null, maleKey: null, femaleKey: null, patterns: [], sections: [] },
    warnings,
  }
}

// ---------- one request per line of music ----------

export interface SystemGroup {
  y0: number // vertical band in the image (source pixels)
  y1: number
  columns: number[]
  measures: number[]
}

/**
 * The lines of music on the page, each a TAB with the staff printed above it: a band from above the
 * staff (tuplet brackets, grace notes) to below the TAB (rhythm stems), with its columns and measures.
 * Each is sent on its own, enlarged, so stems, flags and tuplet numbers are big enough to read.
 */
export function systemGroups(d: Detection, layout: MarkedLayout): SystemGroup[] {
  const groups: SystemGroup[] = []
  const staffIndexes = [...new Set(layout.columns.map((c) => c.staff))].sort((a, b) => a - b)
  for (const i of staffIndexes) {
    const tab = d.staves[i]
    const above = d.staves[i - 1]
    const withStaff = above?.kind === 'staff' && tab.lines[0] - above.lines[above.lines.length - 1] <= tab.spacing * 14
    const y0 = withStaff ? above.lines[0] - above.spacing * 6 : tab.lines[0] - tab.spacing * 3
    const y1 = tab.lines[tab.lines.length - 1] + tab.spacing * 5
    const columns = layout.columns.filter((c) => c.staff === i).map((c) => c.id)
    const measures = layout.measures.filter((m) => m.columns.some((c) => columns.includes(c))).map((m) => m.no)
    groups.push({ y0: Math.max(0, y0), y1: Math.min(d.height, y1), columns, measures })
  }
  // Measures with no numbers at all (whole rests) go with the line they are drawn on.
  for (const m of layout.measures) {
    if (groups.some((g) => g.measures.includes(m.no))) continue
    const before = groups.filter((g) => g.measures.some((n) => n < m.no)).pop() ?? groups[0]
    before?.measures.push(m.no)
  }
  return groups
}

/** The part of the layout one request is about. */
export function subLayout(layout: MarkedLayout, g: SystemGroup): MarkedLayout {
  return { strings: layout.strings, columns: layout.columns.filter((c) => g.columns.includes(c.id)), measures: layout.measures.filter((m) => g.measures.includes(m.no)) }
}

/** Joins the answers for each line of music into one: header facts from the first that gives them. */
export function mergeMarkedAnswers(parts: MarkedAnswer[]): MarkedAnswer {
  const first = <K extends keyof MarkedAnswer>(k: K) => parts.map((p) => p[k]).find((v) => v !== null && v !== undefined && (!Array.isArray(v) || v.length)) ?? null
  return {
    title: first('title') as string | null,
    tempo: first('tempo') as number | null,
    timeSignature: first('timeSignature') as string | null,
    key: first('key') as string | null,
    capo: first('capo') as number | null,
    tuning: first('tuning') as string[] | null,
    columns: parts.flatMap((p) => p.columns ?? []),
    measures: parts.flatMap((p) => p.measures ?? []),
    warnings: parts.flatMap((p) => p.warnings ?? []),
  }
}
