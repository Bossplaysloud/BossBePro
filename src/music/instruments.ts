// Pitches are MIDI note numbers. Tuning arrays are ordered string 1 → string N,
// i.e. highest-pitched string first, matching how TAB is read top to bottom.

export type InstrumentId = 'guitar' | 'bass' | 'ukulele' | 'custom'

export interface TuningPreset {
  id: string
  name: string
  notes: number[]
}

export interface InstrumentPreset {
  id: InstrumentId
  strings: number[] // supported string counts
  tunings: Record<number, TuningPreset[]> // by string count
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function noteName(midi: number, withOctave = false): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name
}

export function parseNote(text: string): number | null {
  const m = /^\s*([A-Ga-g])([#b]?)(-?\d)\s*$/.exec(text)
  if (!m) return null
  let pc = NOTE_NAMES.indexOf(m[1].toUpperCase())
  if (m[2] === '#') pc += 1
  if (m[2] === 'b') pc -= 1
  return (Number(m[3]) + 1) * 12 + pc
}

/** "E A D G B E" style label, lowest string first as players usually say it. */
export function tuningLabel(notes: number[]): string {
  return [...notes].reverse().map((n) => noteName(n)).join(' ')
}

const t = (id: string, name: string, lowToHigh: string): TuningPreset => ({
  id,
  name,
  notes: lowToHigh
    .split(' ')
    .map((s) => parseNote(s)!)
    .reverse(),
})

export const INSTRUMENTS: InstrumentPreset[] = [
  {
    id: 'guitar',
    strings: [6, 7, 8],
    tunings: {
      6: [
        t('std6', 'Standard', 'E2 A2 D3 G3 B3 E4'),
        t('dropd', 'Drop D', 'D2 A2 D3 G3 B3 E4'),
        t('halfdown', 'Half-step down', 'D#2 G#2 C#3 F#3 A#3 D#4'),
        t('dadgad', 'DADGAD', 'D2 A2 D3 G3 A3 D4'),
        t('openg', 'Open G', 'D2 G2 D3 G3 B3 D4'),
        t('opend', 'Open D', 'D2 A2 D3 F#3 A3 D4'),
      ],
      7: [t('std7', 'Standard', 'B1 E2 A2 D3 G3 B3 E4'), t('dropa7', 'Drop A', 'A1 E2 A2 D3 G3 B3 E4')],
      8: [t('std8', 'Standard', 'F#1 B1 E2 A2 D3 G3 B3 E4'), t('drope8', 'Drop E', 'E1 B1 E2 A2 D3 G3 B3 E4')],
    },
  },
  {
    id: 'bass',
    strings: [4, 5, 6],
    tunings: {
      4: [t('bass4', 'Standard', 'E1 A1 D2 G2'), t('bass4dropd', 'Drop D', 'D1 A1 D2 G2')],
      5: [t('bass5', 'Standard', 'B0 E1 A1 D2 G2')],
      6: [t('bass6', 'Standard', 'B0 E1 A1 D2 G2 C3')],
    },
  },
  {
    id: 'ukulele',
    strings: [4],
    tunings: {
      4: [t('uke', 'Standard (G C E A)', 'G4 C4 E4 A4'), t('ukelowg', 'Low G', 'G3 C4 E4 A4')],
    },
  },
  {
    id: 'custom',
    strings: [4, 5, 6, 7, 8],
    tunings: {},
  },
]

export const DEFAULT_FRETS: Record<InstrumentId, number> = { guitar: 24, bass: 24, ukulele: 18, custom: 24 }

export function sheetFrets(sheet: { instrument: InstrumentId; frets?: number }) {
  return sheet.frets ?? DEFAULT_FRETS[sheet.instrument]
}

/** General MIDI programs offered for playback. */
export const PROGRAMS = [24, 25, 26, 27, 28, 29, 30, 32, 33, 34, 35] as const
export const DEFAULT_PROGRAM: Record<InstrumentId, number> = { guitar: 25, bass: 33, ukulele: 24, custom: 25 }

export function sheetProgram(sheet: { instrument: InstrumentId; program?: number }) {
  return sheet.program ?? DEFAULT_PROGRAM[sheet.instrument]
}

export function defaultTuning(instrument: InstrumentId, strings: number): number[] {
  const preset = INSTRUMENTS.find((i) => i.id === instrument)?.tunings[strings]?.[0]
  if (preset) return preset.notes
  // Fallback for custom: guitar standard extended/truncated from the top string down.
  const guitar8 = INSTRUMENTS[0].tunings[8][0].notes
  return guitar8.slice(0, strings)
}
