import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChordChartContent } from '../music/chordChart'
import type { Content } from '../music/rhythm'
import { tidyChart, tidyContent, type LengthFix, type TidyOptions } from '../music/tidy'
import { Modal } from './Modal'
import { useToast } from './Toast'

type Rule = 'overlaps' | 'chords' | 'techniques' | 'emptyEdges'

interface ContentProps<C extends Content> {
  open: boolean
  onClose: () => void
  content: C
  timeSignature: [number, number]
  /** Measure indexes where images 2…n start, when the content came from several images. */
  overlaps?: number[]
  onApply: (next: C) => void
}

/** Lets the user clean up a transcription: each rule shows how many places it would change. */
export function TidyDialog<C extends Content>({ open, onClose, content, timeSignature, overlaps, onApply }: ContentProps<C>) {
  const { t } = useTranslation()
  const toast = useToast()
  const [rules, setRules] = useState<Record<Rule, boolean>>({ overlaps: true, chords: true, techniques: true, emptyEdges: true })
  const [length, setLength] = useState<LengthFix>('smart')

  const options = (only?: Rule | 'length'): TidyOptions => ({
    overlaps: (only ? only === 'overlaps' : rules.overlaps) ? overlaps : undefined,
    chords: only ? only === 'chords' : rules.chords,
    techniques: only ? only === 'techniques' : rules.techniques,
    emptyEdges: only ? only === 'emptyEdges' : rules.emptyEdges,
    length: only ? (only === 'length' ? (length === 'none' ? 'smart' : length) : 'none') : length,
  })

  // What each rule would change on its own (shown next to it).
  const counts = useMemo(() => {
    if (!open) return null
    const run = (r: Rule | 'length') => tidyContent(content, timeSignature, options(r)).report
    return {
      overlaps: overlaps?.length ? run('overlaps').overlaps : 0,
      chords: (() => {
        const r = run('chords')
        return r.chordsFixed + r.chordsRemoved
      })(),
      techniques: run('techniques').techniques,
      emptyEdges: run('emptyEdges').empty,
      length: run('length').lengths,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, content, timeSignature, overlaps, length])

  const total = counts ? (overlaps?.length ? counts.overlaps : 0) + counts.chords + counts.techniques + counts.emptyEdges + counts.length : 0

  const apply = () => {
    const { content: next, report } = tidyContent(content, timeSignature, options())
    onApply(next)
    const parts = [
      report.overlaps && t('tidy.done.overlaps', { count: report.overlaps }),
      report.lengths && t('tidy.done.lengths', { count: report.lengths }),
      report.chordsFixed + report.chordsRemoved && t('tidy.done.chords', { count: report.chordsFixed + report.chordsRemoved }),
      report.techniques && t('tidy.done.techniques', { count: report.techniques }),
      report.empty && t('tidy.done.empty', { count: report.empty }),
    ].filter(Boolean)
    toast(parts.length ? t('tidy.done.summary', { list: parts.join('、') }) : t('tidy.nothing'))
    onClose()
  }

  const ruleRow = (rule: Rule, n: number) => (
    <label key={rule} className="choice tidy-rule">
      <input type="checkbox" checked={rules[rule]} onChange={(e) => setRules({ ...rules, [rule]: e.target.checked })} />
      <span style={{ flex: 1 }}>
        <strong>{t(`tidy.rule.${rule}`)}</strong>
        <br />
        <span className="muted small">{t(`tidy.desc.${rule}`)}</span>
      </span>
      <span className={`tidy-count${n ? ' some' : ''}`}>{n ? t('tidy.found', { count: n }) : t('tidy.ok')}</span>
    </label>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('tidy.title')}
      wide
      actions={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={apply}>{t('tidy.apply')}</button>
        </>
      }
    >
      <p className="muted small" style={{ margin: 0 }}>{total ? t('tidy.intro', { count: total }) : t('tidy.clean')}</p>
      {counts && (
        <div className="stack" style={{ gap: 8 }}>
          {overlaps?.length ? ruleRow('overlaps', counts.overlaps) : null}
          <div className="choice tidy-rule">
            <span style={{ flex: 1 }}>
              <strong>{t('tidy.rule.length')}</strong>
              <br />
              <span className="muted small">{t(`tidy.desc.length.${length}`)}</span>
            </span>
            <select className="select" style={{ width: 'auto' }} value={length} onChange={(e) => setLength(e.target.value as LengthFix)} aria-label={t('tidy.rule.length')}>
              {(['smart', 'reflow', 'none'] as const).map((l) => <option key={l} value={l}>{t(`tidy.length.${l}`)}</option>)}
            </select>
            <span className={`tidy-count${counts.length ? ' some' : ''}`}>{counts.length ? t('tidy.found', { count: counts.length }) : t('tidy.ok')}</span>
          </div>
          {ruleRow('chords', counts.chords)}
          {ruleRow('techniques', counts.techniques)}
          {ruleRow('emptyEdges', counts.emptyEdges)}
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>{t('tidy.undoHint')}</p>
    </Modal>
  )
}

/** Tidy for chord charts: format conversion, chord names, blank lines, capo. */
export function ChartTidyDialog({ open, onClose, chart, onApply }: { open: boolean; onClose: () => void; chart: ChordChartContent; onApply: (next: ChordChartContent) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const preview = useMemo(() => (open ? tidyChart(chart) : null), [open, chart])
  if (!preview) return null
  const r = preview.report
  const items = [
    r.converted && t('tidy.chart.converted'),
    r.repaired && t('tidy.chart.repaired', { count: r.repaired }),
    r.chordsFixed && t('tidy.chart.chords', { count: r.chordsFixed }),
    r.blankLines && t('tidy.chart.blank', { count: r.blankLines }),
    r.capo && t('tidy.chart.capo', { capo: r.capo }),
  ].filter(Boolean) as string[]
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('tidy.title')}
      actions={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!items.length} onClick={() => (onApply(preview.content), toast(t('tidy.done.summary', { list: items.join('、') })), onClose())}>
            {t('tidy.apply')}
          </button>
        </>
      }
    >
      {items.length ? (
        <ul className="tidy-list">{items.map((i) => <li key={i}>{i}</li>)}</ul>
      ) : (
        <p style={{ margin: 0 }}>{t('tidy.clean')}</p>
      )}
      <p className="muted small" style={{ margin: 0 }}>{t('tidy.undoHint')}</p>
    </Modal>
  )
}
