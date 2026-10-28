// The JSON every AI provider must return when transcribing a sheet image.
// One flat schema (no unions of shapes) so all three providers' structured-output modes accept it.

export const TECHNIQUES = ['hammer', 'pull', 'slide', 'slideIn', 'slideOut', 'bend', 'release', 'harmonic', 'palmMute', 'vibrato', 'letRing', 'ghost', 'tap'] as const
export type TechniqueName = (typeof TECHNIQUES)[number]

export interface RecognizedTabNote {
  string: number // 1 = highest-pitched string (top TAB line)
  fret: number | null // null with dead = true for "x"
  dead: boolean
  tie: boolean
  techniques: TechniqueName[]
  /** Read details for some techniques (TAB image recognition): bend amount in steps, harmonic kind, tapping. */
  bend?: number
  harmonic?: 'natural' | 'artificial'
  tap?: boolean
}

export interface RecognizedBeat {
  duration: '1' | '2' | '4' | '8' | '16' | '32'
  dotted: boolean
  /** Tuplet number (3 triplet, 5, 6 sextuplet); 0 or absent = none. */
  tuplet?: number
  /** Older form of `tuplet: 3`, still read when `tuplet` is absent. */
  triplet?: boolean
  chord: string | null
  lyric: string | null
  tab: RecognizedTabNote[] // TAB only
  pitch: string | null // staff only, as written, e.g. "F#4"; null = rest
  degree: string | null // numbered only, e.g. "5", "#4", "1'", "6,"; "0" = rest
  tie: boolean // staff / numbered: continues the previous note
  x?: number | null // horizontal position of the column, 0 = left edge of the image, 1000 = right edge
  /** A grace note (small note taking no time). */
  grace?: boolean
  /** Staff read by the app's rules: written notes (MIDI before the guitar octave), used instead of pitch. */
  notes?: { midi: number; spelling?: 'sharp' | 'flat'; tie?: boolean; string?: number; finger?: number }[]
}

export interface RecognizedMeasure {
  timeSignature: string | null // only when it changes here, e.g. "3/4"
  beats: RecognizedBeat[]
  start?: number | null // positions of the bar lines around the measure, 0–1000
  end?: number | null
  /** Staff: a second voice (stems down), as beats like `beats`. */
  voice2?: RecognizedBeat[]
}

export interface RecognizedChart {
  originalKey: string | null // 原調
  writtenKey: string | null // key the chord names are written in
  maleKey: string | null // 男調
  femaleKey: string | null // 女調
  patterns: { label: string; beats: { symbols: { text: string; duration: '4' | '8' | '16' | '32'; dotted: boolean }[]; barAfter: boolean }[] }[] // 指法 / 刷法 …
  sections: {
    label: string | null
    lines: {
      bars: { segments: { chord: string | null; lyric: string; x?: number | null }[] }[]
      repeat: string | null
      note: string | null
      /** Horizontal extent of the lyric line, 0 = left edge of the image, 1000 = right edge. */
      lyricStart?: number | null
      lyricEnd?: number | null
    }[]
  }[]
}

export interface Recognition {
  notation: 'tab' | 'staff' | 'numbered' | 'chord' | 'unknown'
  title: string | null
  strings: number | null
  tuning: string[] | null // lowest string first, e.g. ["E2","A2","D3","G3","B3","E4"]
  key: string | null // e.g. "G", "Em"
  timeSignature: string | null // e.g. "4/4"
  tempo: number | null
  capo: number | null
  measures: RecognizedMeasure[]
  chart: RecognizedChart // chord charts; empty for other notations
  /** Older/simple form of a chord chart: "[C]lyrics" text. */
  chordChart?: string | null
  warnings: string[]
}

/** The beat's tuplet number (3, 5 or 6), also from the older `triplet` flag; 0 = none. */
export const tupletOf = (b: Pick<RecognizedBeat, 'tuplet' | 'triplet'>): number => (b.tuplet !== undefined && b.tuplet !== null ? b.tuplet : b.triplet ? 3 : 0)

/** Played length of a tuplet note relative to its written value: 3 → 2/3, 5 → 4/5, 6 → 4/6. */
export const tupletRatio = (n: number) => (n >= 2 ? 2 ** Math.floor(Math.log2(n)) / n : 1)

export const emptyChart = (): RecognizedChart => ({ originalKey: null, writtenKey: null, maleKey: null, femaleKey: null, patterns: [], sections: [] })

const nullable = (type: string) => ({ type: [type, 'null'] })

const tabNote = {
  type: 'object',
  additionalProperties: false,
  required: ['string', 'fret', 'dead', 'tie', 'techniques'],
  properties: {
    string: { type: 'integer', description: 'String number, 1 = highest-pitched string = top line of the TAB' },
    fret: { ...nullable('integer'), description: 'Fret number; null for a dead note "x"' },
    dead: { type: 'boolean' },
    tie: { type: 'boolean', description: 'Continues the same note from the previous beat (tie / let ring across beats)' },
    techniques: { type: 'array', items: { type: 'string', enum: [...TECHNIQUES] }, description: 'Techniques applied to this note: hammer = h into the next note, pull = p into the next note, slide = / or \\ into the next note' },
  },
}

const beat = {
  type: 'object',
  additionalProperties: false,
  required: ['duration', 'dotted', 'tuplet', 'chord', 'lyric', 'tab', 'pitch', 'degree', 'tie', 'x'],
  properties: {
    duration: { type: 'string', enum: ['1', '2', '4', '8', '16', '32'], description: 'Note value: 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth, 32 thirty-second' },
    dotted: { type: 'boolean' },
    tuplet: { type: 'integer', description: 'The number of a tuplet bracket over this note: 3 = triplet (three in the time of two), 6 = sextuplet (six in the time of four), 5 = quintuplet; 0 when there is none' },
    chord: { ...nullable('string'), description: 'Chord symbol written above this beat, e.g. "Am7"' },
    lyric: { ...nullable('string'), description: 'Lyric syllable under this beat, in the original language' },
    tab: { type: 'array', items: tabNote, description: 'TAB only: every note sounding on this beat; empty for a rest or for other notations' },
    pitch: { ...nullable('string'), description: 'Staff only: written pitch with octave, accidentals from the key signature applied, e.g. "F#4", "Bb3"; null for a rest' },
    degree: { ...nullable('string'), description: 'Numbered notation only: digit 1-7 with optional # or b prefix, one \' per dot above, one , per dot below, e.g. "5", "#4", "1\'", "6,"; "0" for a rest' },
    tie: { type: 'boolean', description: 'Staff / numbered: this beat continues the previous note (tie arc or dash extension)' },
    x: { ...nullable('integer'), description: 'Horizontal position of this beat (the TAB column or the note): 0 = left edge of the image, 1000 = right edge' },
  },
}

const chart = {
  type: 'object',
  additionalProperties: false,
  required: ['originalKey', 'writtenKey', 'maleKey', 'femaleKey', 'patterns', 'sections'],
  description: 'Chord charts only; for other notations use nulls and empty arrays',
  properties: {
    originalKey: { ...nullable('string'), description: 'Original key as printed (原調), e.g. "Ab"' },
    writtenKey: { ...nullable('string'), description: 'Key the chord names on the chart are written in, judged from the chords (e.g. chords G D/F# Em C → "G")' },
    maleKey: { ...nullable('string'), description: 'Male key (男調) if printed' },
    femaleKey: { ...nullable('string'), description: 'Female key (女調) if printed' },
    patterns: {
      type: 'array',
      description: 'Picking / strumming patterns printed at the top (指法, 刷法, 節奏)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'beats'],
        properties: {
          label: { type: 'string', description: 'e.g. "指法" or "刷法", without brackets' },
          beats: {
            type: 'array',
            description: 'One entry per beat (per printed group, including a lone "X"), left to right. The durations inside one beat must add up to exactly one beat.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['symbols', 'barAfter'],
              properties: {
                symbols: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['text', 'duration', 'dotted'],
                    properties: {
                      text: {
                        type: 'string',
                        description: 'One symbol: X, ↑, ↓, T, 1, 2, 3, several strings played together like "(12)", or "-" for a silent step (no strum / no pluck). Keep every "-": it takes time like any other symbol.',
                      },
                      duration: {
                        type: 'string',
                        enum: ['4', '8', '16', '32'],
                        description: 'From the underlines under THIS symbol: none = "4", one line = "8", two lines = "16", three = "32". A line drawn under several symbols counts for each of them.',
                      },
                      dotted: { type: 'boolean' },
                    },
                  },
                },
                barAfter: { type: 'boolean', description: 'A bar line "|" is printed after this beat' },
              },
            },
          },
        },
      },
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'lines'],
        properties: {
          label: { ...nullable('string'), description: 'Section name without brackets, e.g. "前奏", "主歌", "副歌", "間奏1", "尾奏"; put an ending number first, e.g. "(1) 間奏1"; null for a group of lines without a printed name (a new group starts after every empty row)' },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['bars', 'repeat', 'note', 'lyricStart', 'lyricEnd'],
              properties: {
                bars: {
                  type: 'array',
                  description: 'The bars of one printed chord line, split at EVERY bar line "|" (a bar can hold several chords: "|D  A/C# |" is one bar with D and A/C#)',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['segments'],
                    properties: {
                      segments: {
                        type: 'array',
                        description: 'Left to right inside this bar: each chord with the lyric characters printed under it, from the chord up to the next chord or bar line. Lyric text before the first chord of the bar gets chord null.',
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['chord', 'lyric', 'x'],
                          properties: {
                            chord: nullable('string'),
                            lyric: { type: 'string', description: 'Exact characters, including spaces and marks like ▲ ★; empty for instrumental bars. Never copy "-" fillers from the chord line.' },
                            x: { ...nullable('integer'), description: 'Horizontal position of the first letter of the chord: 0 = left edge of the image, 1000 = right edge; null without a chord' },
                          },
                        },
                      },
                    },
                  },
                },
                lyricStart: { ...nullable('integer'), description: 'Horizontal position where the lyric text under this line starts (0 = left edge of the image, 1000 = right edge); null without lyrics' },
                lyricEnd: { ...nullable('integer'), description: 'Horizontal position where the lyric text ends; null without lyrics' },
                repeat: { ...nullable('string'), description: 'Repeat mark after the line, e.g. "x2"' },
                note: { ...nullable('string'), description: 'Other marks after the line, e.g. "(回▲)"' },
              },
            },
          },
        },
      },
    },
  },
}

export const RECOGNITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notation', 'title', 'strings', 'tuning', 'key', 'timeSignature', 'tempo', 'capo', 'measures', 'chart', 'warnings'],
  properties: {
    notation: { type: 'string', enum: ['tab', 'staff', 'numbered', 'chord', 'unknown'] },
    title: nullable('string'),
    strings: { ...nullable('integer'), description: 'TAB: number of lines (strings), 4 to 8' },
    tuning: { type: ['array', 'null'], items: { type: 'string' }, description: 'Tuning if written on the sheet, lowest string first, e.g. ["D2","A2","D3","G3","B3","E4"]; null if not shown' },
    key: { ...nullable('string'), description: 'Key, e.g. "G" or "Em"; for numbered notation the key from "1=G"' },
    timeSignature: { ...nullable('string'), description: 'Starting time signature, e.g. "4/4"' },
    tempo: nullable('integer'),
    capo: nullable('integer'),
    measures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['timeSignature', 'beats', 'start', 'end'],
        properties: {
          timeSignature: { ...nullable('string'), description: 'Only when the time signature changes at this bar' },
          beats: { type: 'array', items: beat, description: 'TAB: one entry per column of vertically aligned numbers, left to right. The durations must add up to the time signature.' },
          start: { ...nullable('integer'), description: 'Horizontal position of the bar line where this measure starts (0–1000 across the image)' },
          end: { ...nullable('integer'), description: 'Horizontal position of the bar line where this measure ends' },
        },
      },
    },
    chart,
    warnings: { type: 'array', items: { type: 'string' }, description: 'Anything unclear or guessed (e.g. unreadable bars, estimated rhythm)' },
  },
}

export function buildPrompt(opts: { language: 'zh-TW' | 'en'; expected: 'auto' | 'tab' | 'staff' | 'numbered' | 'chord'; strings?: number; context?: string }) {
  const lang = opts.language === 'zh-TW' ? 'Traditional Chinese (繁體中文)' : 'English'
  return [
    'Transcribe the sheet music in this image for a string-instrument practice app. Return only the JSON described by the schema.',
    '',
    'First decide the notation: "tab" (tablature: horizontal lines with fret numbers), "staff" (standard five-line notation), "numbered" (numbered notation / jianpu: digits 1-7 with dots and underlines), "chord" (lyrics with chord names and no rhythm). Use "unknown" if it is not music.',
    opts.expected !== 'auto' ? `The user says this is "${opts.expected}" notation.` : '',
    opts.strings ? `The user's instrument has ${opts.strings} strings.` : '',
    opts.context ?? '',
    '',
    'Transcribe what is written, bar by bar, in reading order across all systems. Do not invent or "fix" notes. If a part is unreadable, leave it out and add a warning.',
    '- Capo: copy "Capo fret 3" / "Capo 3" into capo; frets are written relative to the capo, copy them as printed.',
    '- All notations: bar lines "|" separate measures; "||" and ":|" mark section ends and repeats; "x2" after a line means it is played twice (write it once and add a warning naming the repeat).',
    '- TAB: string 1 is the TOP line (highest pitch). Read the TAB column by column: one beat = all numbers stacked vertically at the same position; give its x. For every number find its line by counting from the top line and check it against the other numbers in the column. Give each measure start and end, the positions of its bar lines. Read techniques: h / H hammer, p / P pull-off, / \\ sl. slides, b bend, r release, ~ vibrato, <12> harmonic, (5) ghost note, x dead note, T above a note tap (tapping); H, P or sl. printed above two notes belongs to the first of them. P.M. and "let ring" with a dashed line are not notes: mark palmMute / letRing on the notes under the line.',
    '- TAB with a standard staff above it: frets and strings come ONLY from the TAB numbers; use the staff only for the rhythm (stems, flags, beams, dots, rests, tuplet brackets). A note tied by a curved tie to the one before it is not played again and has no new number in the TAB: do not add a beat for it, make the earlier beat longer instead (or, if the bar needs a beat there, use tie true). Never add notes that are not printed as numbers in the TAB.',
    '- TAB rhythm: if stems/flags/beams are shown (under the TAB or in the staff above), copy them: 1 beam or flag = eighth, 2 = sixteenth, a dot adds half, a bracket "3" over notes makes exactly those notes triplets (tuplet 3), a bracket "6" sextuplets (tuplet 6). The durations in each measure must add up to the time signature (6/8 = six eighths; 3/4 = three quarters). If no rhythm is shown, estimate from spacing (evenly spaced notes are usually eighths) and add a warning that rhythm was estimated.',
    '- Staff: give each note\'s written pitch with octave and the key signature applied (e.g. in G major an F is "F#4"). Rests have pitch null. Use one beat per note or chord (only the top note of a chord).',
    '- Numbered notation: copy the key from "1=X" into key. Each digit is one beat: dots above → one \' each, dots below → one , each; underlines halve the duration (one line = 8, two = 16); each dash "–" after a note adds a quarter (so "5 –" is a half note "2"); "0" is a rest.',
    '- Chord charts (lyrics with chord names above them): fill "chart" and leave measures empty. Work line by line and bar by bar: a chord line is split into bars at every "|"; for each bar list its chords left to right, each with the lyric characters printed under it, from the character directly below the chord\'s first letter up to the next chord. Lyrics are often not lined up with the bar lines: decide by horizontal position, never by order (a chord far to the right sits over a character far to the right; do not stack the chords first and the lyrics after). For every chord give x, its horizontal position, and for every lyric line lyricStart and lyricEnd. "-" or "- -" between chords on a chord line ("|F#m/C#  - -  F#7/A# |") only fill beats: skip them and never copy them into the lyrics. Copy lyric characters exactly (keep spaces, ▲, ★ and other marks). Lines with chords but no lyrics (前奏, 間奏, 尾奏 progressions such as "||G |D/F# |Cmaj7 |D11 || x2") are bars with empty lyrics, and their "x2" goes into repeat; if a repeat mark sits in the middle of a line ("|D11 || x2 |C |G |"), split it into two lines there. Put section names (前奏, 主歌, 副歌, 間奏1, 尾奏, Verse, Chorus …) into sections, never into lyrics or chords, even when the name is printed on the same row as the chords ("[間奏2] |D |F#m/C# |" → a section labelled 間奏2 whose line has the bars). An ending number printed above or before a name ("(1)" then "[間奏1]") is part of that one label: "(1) 間奏1". A section name printed at the start of a line (e.g. "[間奏1] |D A/C# |Bm7 |G |") names only the bars on that line: the lines after it that have lyrics under them are sung lines, so start a new section with label null for them and copy their lyrics like any other sung line. Every chord line that has a lyric line under it keeps that lyric; never drop lyrics because they follow an instrumental part. A chord row and the lyric row printed right under it are ONE line (one entry in lines, chords and lyrics together); never return them as two lines or put them in different sections. An empty row between lines on the sheet separates groups: start a new section (label null when no name is printed) after every empty row, so the groups stay apart. Shaded background stripes are not empty rows. Marks like (回▲) or "回到 ★" go into note. Copy 原調 / 男調 / 女調 into originalKey / maleKey / femaleKey, judge writtenKey from the chords themselves, and copy 指法 / 刷法 into patterns: one beat per printed group, keeping every symbol including "-" (a silent step), and for every symbol count the underlines under it. Examples: "↑↑↓" with one line under all three and a second line under the last two is ↑ = "8", ↑ = "16", ↓ = "16"; "↑--↓" with a double line under the whole group is four sixteenths ↑ - - ↓ ("16" each); a single line under "T1" is two eighths. The values in one beat always add up to one beat. Put 拍速 into tempo, 拍號 into timeSignature and Capo into capo when printed.',
    '- Chord names above notes go into "chord"; lyrics under notes go into "lyric", one syllable/character per beat.',
    '',
    `Write warnings in ${lang}. Keep the title and lyrics in their original language.`,
  ]
    .filter((l) => l !== '')
    .join('\n')
}

// ---------- Schemas without "or null" ----------
// Claude's structured output limits how many fields may have a union type (["string", "null"]),
// so for Claude every nullable field becomes a plain one with an "absent" value: "" for text,
// -1 for numbers, [] for lists. restoreNulls turns those back into null.

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; items?: JsonSchema; description?: string; [k: string]: unknown }

const ABSENT: Record<string, { value: unknown; note: string }> = {
  string: { value: '', note: 'Use "" when absent.' },
  integer: { value: -1, note: 'Use -1 when absent.' },
  number: { value: -1, note: 'Use -1 when absent.' },
  array: { value: [], note: 'Use [] when absent.' },
}

export function withoutNulls(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema }
  if (Array.isArray(schema.type)) {
    const base = schema.type.find((t) => t !== 'null')!
    out.type = base
    out.description = [schema.description, ABSENT[base]?.note].filter(Boolean).join(' ')
  }
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, withoutNulls(v)]))
  if (schema.items) out.items = withoutNulls(schema.items)
  return out
}

export function restoreNulls(value: unknown, schema: JsonSchema): unknown {
  if (Array.isArray(schema.type) && schema.type.includes('null')) {
    const base = schema.type.find((t) => t !== 'null')!
    const absent = ABSENT[base]?.value
    if (value === absent || (Array.isArray(absent) && Array.isArray(value) && !value.length)) return null
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, schema.properties![k] ? restoreNulls(v, schema.properties![k]) : v]))
  }
  if (schema.items && Array.isArray(value)) return value.map((v) => restoreNulls(v, schema.items!))
  return value
}

export const CLAUDE_SCHEMA = withoutNulls(RECOGNITION_SCHEMA as JsonSchema)
