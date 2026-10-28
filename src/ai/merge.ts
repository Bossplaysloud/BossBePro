// Combining the transcriptions of several images (e.g. consecutive screenshots of one song).

import { emptyChart, type Recognition, type RecognizedChart } from './schema'

/** Context passed to the AI for image n > 1 so the pages are read consistently. */
export function continuationHint(previous: Recognition[], index: number, total: number): string {
  const known = previous.find((r) => r.notation !== 'unknown')
  if (!known) return `This is image ${index + 1} of ${total} of the same sheet.`
  const facts = [
    `notation "${known.notation}"`,
    known.strings ? `${known.strings} strings` : '',
    known.tuning ? `tuning ${known.tuning.join(' ')}` : '',
    known.key ? `key ${known.key}` : '',
    known.timeSignature ? `time signature ${known.timeSignature}` : '',
  ].filter(Boolean)
  return `This is image ${index + 1} of ${total} of the same sheet; it continues right after the previous image. The earlier images were read as ${facts.join(', ')}. Use the same settings unless this image clearly shows a change, and do not repeat bars from earlier images. Leave title null unless a new title is shown.${known.notation === 'chord' ? ' Read the chord chart exactly like the first image: each chord row together with the lyric row under it is one line, split into bars at every "|".' : ''}`
}

/**
 * Merges per-image results in order: settings from the first image that states them,
 * measures and chord-chart text appended, warnings tagged with their image number.
 */
export function mergeRecognitions(results: Recognition[], tagWarning: (image: number, text: string) => string): Recognition {
  if (results.length === 1) return results[0]
  const usable = results.filter((r) => r.notation !== 'unknown')
  const first = <K extends keyof Recognition>(k: K) => usable.map((r) => r[k]).find((v) => v !== null && v !== undefined) ?? null
  const notation = usable[0]?.notation ?? 'unknown'
  const charts = usable.map((r) => r.chordChart?.trim()).filter(Boolean)
  const parts = usable.map((r) => r.chart ?? emptyChart())
  const firstOf = <K extends keyof RecognizedChart>(k: K) => parts.map((c) => c[k]).find((v) => v !== null && v !== undefined && (!Array.isArray(v) || v.length)) ?? null
  const chart: RecognizedChart = {
    originalKey: firstOf('originalKey') as string | null,
    writtenKey: firstOf('writtenKey') as string | null,
    maleKey: firstOf('maleKey') as string | null,
    femaleKey: firstOf('femaleKey') as string | null,
    patterns: (firstOf('patterns') as RecognizedChart['patterns'] | null) ?? [],
    sections: parts.flatMap((c) => c.sections),
  }
  return {
    notation,
    title: first('title') as string | null,
    strings: first('strings') as number | null,
    tuning: first('tuning') as string[] | null,
    key: first('key') as string | null,
    timeSignature: first('timeSignature') as string | null,
    tempo: first('tempo') as number | null,
    capo: first('capo') as number | null,
    measures: usable.flatMap((r) => r.measures),
    chart,
    chordChart: charts.length ? charts.join('\n\n') : null,
    warnings: results.flatMap((r, i) => [
      ...(r.notation === 'unknown' ? [tagWarning(i + 1, '—')] : []),
      ...(r.warnings ?? []).map((w) => tagWarning(i + 1, w)),
    ]),
  }
}
