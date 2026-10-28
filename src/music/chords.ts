// Chord names → chord tones, degree labels, and playable voicings for any tuning.

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export interface Chord {
  name: string
  root: number // pitch class
  bass: number // pitch class of the lowest note (slash chords), = root otherwise
  /** Semitones above the root (0–11) → degree name, e.g. 3 → "♭3", 10 → "♭7". */
  degrees: Map<number, string>
  /** Tones a voicing must contain (the 5th and 11th/13th may be omitted). */
  required: number[]
}

export function parsePitchClass(text: string): number | null {
  const m = /^([A-Ga-g])([#♯b♭]?)$/.exec(text)
  if (!m) return null
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0
  return (PC[m[1].toUpperCase()] + acc + 12) % 12
}

/**
 * Parses common chord symbols: C, Cm, C7, Cmaj7, CM7, CΔ, Cm7, Cm7b5, Cø, Cdim, C°, Cdim7, Caug, C+,
 * Csus2, Csus4, C5, C6, Cm6, C9, Cmaj9, Cm9, Cadd9, C11, C13, C7b9, C7#9, C7#11, C7b13, C/G …
 */
export function parseChord(input: string): Chord | null {
  const name = input.trim()
  const m = /^([A-Ga-g][#♯b♭]?)(.*?)(?:\/([A-Ga-g][#♯b♭]?))?$/.exec(name)
  if (!m) return null
  const root = parsePitchClass(m[1])
  if (root === null) return null
  const bass = m[3] ? parsePitchClass(m[3]) : root
  if (bass === null) return null
  let q = m[2].replace(/\s+/g, '').replace(/♭/g, 'b').replace(/♯/g, '#')

  const deg = new Map<number, string>([[0, 'R']])
  let third: number | null = 4 // 2 = sus2, 5 = sus4
  let fifth: number | null = 7
  let seventh: number | null = null
  const required = new Set<number>([0])
  const take = (re: RegExp) => {
    const hit = re.exec(q)
    if (hit && hit.index === 0) {
      q = q.slice(hit[0].length)
      return hit[0]
    }
    return null
  }

  // Quality
  if (take(/^(ø|m7b5|min7b5|-7b5)/)) [third, fifth, seventh] = [3, 6, 10]
  else if (take(/^(dim7|°7|o7)/)) [third, fifth, seventh] = [3, 6, 9]
  else if (take(/^(dim|°|o)(?!\d)/)) [third, fifth] = [3, 6]
  else if (take(/^(aug|\+)/)) fifth = 8
  else if (take(/^(maj|M|Δ)(?=7|9|11|13|$)/)) seventh = 11
  else if (take(/^(min|m|-)(?!aj)/)) {
    third = 3
    if (take(/^(maj|Maj|M|Δ)/)) seventh = 11 // mMaj7
  }

  // Power chord
  if (q === '5') {
    q = ''
    third = null
  }

  // Extension
  const ext = take(/^(13|11|9|7|6)/)
  const exts: number[] = []
  if (ext === '6') exts.push(9)
  else if (ext) {
    seventh ??= 10
    if (ext !== '7') exts.push(14)
    if (ext === '11' || ext === '13') exts.push(17)
    if (ext === '13') exts.push(21)
  }

  // Suspensions, additions and alterations, in any order
  for (let guard = 0; q && guard < 10; guard++) {
    if (take(/^sus2/)) third = 2
    else if (take(/^sus4?/)) third = 5
    else if (take(/^add9|^add2/)) exts.push(14)
    else if (take(/^add11|^add4/)) exts.push(17)
    else if (take(/^add13|^add6/)) exts.push(21)
    else if (take(/^b5|^-5/)) fifth = 6
    else if (take(/^#5|^\+5/)) fifth = 8
    else if (take(/^b9/)) exts.push(13)
    else if (take(/^#9/)) exts.push(15)
    else if (take(/^#11/)) exts.push(18)
    else if (take(/^b13/)) exts.push(20)
    else if (take(/^[()]/)) continue
    else return null
  }

  if (third !== null) {
    deg.set(third, third === 3 ? '♭3' : third === 4 ? '3' : third === 2 ? '2' : '4')
    required.add(third)
  }
  if (fifth !== null) deg.set(fifth, fifth === 6 ? '♭5' : fifth === 8 ? '♯5' : '5')
  if (fifth !== null && fifth !== 7) required.add(fifth) // altered fifths are characteristic
  if (third === null && fifth !== null) required.add(fifth) // power chord
  if (seventh !== null) {
    deg.set(seventh, seventh === 9 ? '𝄫7' : seventh === 10 ? '♭7' : '7')
    required.add(seventh)
  }
  if (ext === '6') {
    deg.set(9, '6')
    required.add(9)
  }
  const EXT_NAMES: Record<number, string> = { 13: '♭9', 14: '9', 15: '♯9', 17: '11', 18: '♯11', 20: '♭13', 21: '13' }
  for (const e of exts) {
    const pc = e % 12
    if (!deg.has(pc)) deg.set(pc, EXT_NAMES[e])
    if (e !== 17 && e !== 21) required.add(pc) // 11ths and 13ths are often left out
  }
  if (bass !== root) {
    const b = (bass - root + 12) % 12
    if (!deg.has(b)) deg.set(b, NAMES_FROM_ROOT[b])
  }
  return { name, root, bass, degrees: deg, required: [...required] }
}

/** Fallback interval names (relative to a chord root) for notes outside the chord. */
const NAMES_FROM_ROOT = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7']

/** Degree of a pitch relative to a chord: its chord-tone name, or a plain interval name. */
export function chordDegree(midi: number, chord: Chord): string {
  const i = (((midi - chord.root) % 12) + 12) % 12
  return chord.degrees.get(i) ?? NAMES_FROM_ROOT[i]
}

export function isChordTone(midi: number, chord: Chord) {
  return chord.degrees.has((((midi - chord.root) % 12) + 12) % 12)
}

// ---------- keys / numbered notation ----------

/** Keys offered in the sheet settings. */
export const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm']

const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']

/** The key a chord most likely implies (its root, minor if the chord is minor), spelled as in KEYS. */
export function keyFromChord(name: string): string | null {
  const c = parseChord(name)
  if (!c) return null
  const minor = c.degrees.has(3) && !c.degrees.has(4)
  return (minor ? MINOR_KEYS : MAJOR_KEYS)[c.root]
}

/** A key name moved by `semitones`, spelled as in the app's key list (e.g. "G" +2 → "A", "Am" −1 → "G#m"). */
export function transposeKey(key: string, semitones: number) {
  const minor = /m$/.test(key)
  const pc = parsePitchClass(minor ? key.slice(0, -1) : key) ?? 0
  const i = (((pc + semitones) % 12) + 12) % 12
  return (minor ? MINOR_KEYS : MAJOR_KEYS)[i]
}

/** Numbered-notation degree names relative to "1" (as written in 簡譜: #4, b7 …). */
const SCALE_DEGREES = ['1', '♯1', '2', '♭3', '3', '4', '♯4', '5', '♯5', '6', '♭7', '7']

/**
 * Pitch class of "1" for a key. Minor keys use their relative major, as numbered notation
 * conventionally writes A minor with 1=C (the tonic is 6).
 */
export function keyTonic(key: string): number {
  const minor = /m$/.test(key)
  const pc = parsePitchClass(minor ? key.slice(0, -1) : key) ?? 0
  return minor ? (pc + 3) % 12 : pc
}

export function scaleDegree(midi: number, tonic: number) {
  return SCALE_DEGREES[(((midi - tonic) % 12) + 12) % 12]
}

// ---------- voicings ----------

export interface Voicing {
  /** Fret per string (string 1 first); null = not played. */
  frets: (number | null)[]
  baseFret: number
}

/**
 * Finds playable shapes: within a 4-fret window (open strings allowed), the lowest sounded
 * note is the bass, strings above it all sound (the top string may be left out), and every
 * required chord tone is present. Best (lowest, fullest) shapes first.
 */
export function findVoicings(chord: Chord, tuning: number[], maxFret: number, limit = 8): Voicing[] {
  const n = tuning.length
  const pcs = new Set([...chord.degrees.keys()].map((i) => (chord.root + i) % 12))
  pcs.add(chord.bass)
  const results: { v: Voicing; score: number }[] = []
  const seen = new Set<string>()
  const minSounding = Math.min(n, n <= 4 ? 3 : 4)
  const descending = tuning.every((p, k) => k === 0 || p < tuning[k - 1])

  for (let start = 0; start <= Math.min(maxFret - 3, 14); start++) {
    const window = start === 0 ? [0, 1, 2, 3] : [0, start, start + 1, start + 2, start + 3]
    const options = tuning.map((open) => window.filter((f) => f <= maxFret && pcs.has((open + f) % 12)))
    const frets: (number | null)[] = Array(n).fill(null)

    const accept = () => {
      const sounding = frets.flatMap((f, k) => (f === null ? [] : [tuning[k] + f]))
      if (sounding.length < minSounding) return
      if (Math.min(...sounding) % 12 !== chord.bass) return
      const set = new Set(sounding.map((p) => p % 12))
      if (!chord.required.every((r) => set.has((chord.root + r) % 12))) return
      const fretted = frets.filter((f): f is number => f !== null && f > 0)
      if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 3) return
      const key = frets.join(',')
      if (seen.has(key)) return
      seen.add(key)
      const low = fretted.length ? Math.min(...fretted) : 0
      const muted = n - sounding.length
      const score = low * 2 + muted * 3 + (set.has((chord.root + 7) % 12) ? 0 : 1) + (fretted.length > 4 ? 2 : 0)
      results.push({ v: { frets: [...frets], baseFret: low }, score })
    }

    if (!descending) {
      // Re-entrant tunings (e.g. ukulele with high G): string order says nothing about pitch,
      // so try every combination (these instruments have few strings).
      const all = (i: number) => {
        if (i === n) return accept()
        for (const f of [null, ...options[i]]) {
          frets[i] = f
          all(i + 1)
        }
        frets[i] = null
      }
      all(0)
      continue
    }

    // Walk from the lowest string (index n-1) up to string 1.
    const dfs = (i: number, started: boolean) => {
      if (i < 0) return accept()
      if (!started) {
        // Still below the bass: either mute this string or place the bass note here.
        frets[i] = null
        if (i >= minSounding - 1) dfs(i - 1, false)
        for (const f of options[i]) {
          if ((tuning[i] + f) % 12 !== chord.bass) continue
          frets[i] = f
          dfs(i - 1, true)
        }
        frets[i] = null
        return
      }
      for (const f of options[i]) {
        frets[i] = f
        dfs(i - 1, true)
      }
      if (i === 0) {
        frets[i] = null
        dfs(i - 1, true)
      }
      frets[i] = null
    }
    dfs(n - 1, false)
  }
  return results
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((r) => r.v)
}

/** "x32010" style label, lowest string first. */
export function voicingLabel(v: Voicing) {
  const parts = [...v.frets].reverse().map((f) => (f === null ? 'x' : String(f)))
  return parts.some((p) => p.length > 1) ? parts.join('-') : parts.join('')
}
