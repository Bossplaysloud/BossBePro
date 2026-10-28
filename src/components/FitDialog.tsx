import { useTranslation } from 'react-i18next'
import {
  fillWithRests,
  fitTimeSignature,
  fittingTimeSignature,
  measureCapacity,
  measureTicks,
  overflowToNewMeasure,
  reflowFrom,
  scaleMeasure,
  toggleFree,
  trimToFit,
  tsAt,
  type Content,
} from '../music/rhythm'
import { Modal } from './Modal'

interface Props<C extends Content> {
  measure: number | null
  content: C
  base: [number, number]
  onApply: (next: C) => void
  onClose: () => void
}

/** Count in beat units of the time signature, e.g. 4.5 → "4½". */
function beats(ticks: number, unit: number) {
  const v = Math.round((ticks / unit) * 100) / 100
  const whole = Math.floor(v)
  const frac = v - whole
  const FRACS: [number, string][] = [[0.5, '½'], [0.25, '¼'], [0.75, '¾']]
  const f = FRACS.find(([x]) => Math.abs(frac - x) < 0.01)
  return frac < 0.01 ? String(whole) : f ? `${whole || ''}${f[1]}` : `≈${v.toFixed(2)}`
}

/** Ways to fix a measure whose beats do not add up to its time signature. */
export function FitDialog<C extends Content>({ measure: m, content, base, onApply, onClose }: Props<C>) {
  const { t } = useTranslation()
  if (m === null || !content.measures[m]) return null

  const measure = content.measures[m]
  const ts = tsAt(content, m, base)
  const unit = 3840 / ts[1]
  const total = measureTicks(measure)
  const cap = measureCapacity(ts)
  const diff = total - cap
  const fitTs = fittingTimeSignature(measure)
  const halved = scaleMeasure(content, m, 2)
  const doubled = scaleMeasure(content, m, 0.5)

  const options: { key: string; title: string; desc: string; run: () => C }[] = []
  if (diff > 0) {
    options.push(
      { key: 'overflow', title: t('fit.overflow'), desc: t('fit.overflowDesc'), run: () => overflowToNewMeasure(content, m, base) },
      { key: 'reflow', title: t('fit.reflow'), desc: t('fit.reflowDesc'), run: () => reflowFrom(content, m, base) },
    )
  }
  if (diff < 0) {
    options.push(
      { key: 'fill', title: t('fit.fill'), desc: t('fit.fillDesc'), run: () => fillWithRests(content, m, base) },
      { key: 'pull', title: t('fit.pull'), desc: t('fit.pullDesc'), run: () => reflowFrom(content, m, base) },
    )
  }
  if (diff !== 0 && fitTs) {
    options.push({ key: 'ts', title: t('fit.ts', { ts: fitTs.join('/') }), desc: t('fit.tsDesc', { ts: ts.join('/') }), run: () => fitTimeSignature(content, m, base) })
  }
  if (diff > 0) options.push({ key: 'trim', title: t('fit.trim'), desc: t('fit.trimDesc'), run: () => trimToFit(content, m, base) })
  if (halved) options.push({ key: 'half', title: t('fit.half'), desc: t('fit.halfDesc'), run: () => halved })
  if (doubled) options.push({ key: 'double', title: t('fit.double'), desc: t('fit.doubleDesc'), run: () => doubled })
  options.push({
    key: 'free',
    title: measure.free ? t('fit.unfree') : t('fit.free'),
    desc: measure.free ? t('fit.unfreeDesc') : t('fit.freeDesc'),
    run: () => toggleFree(content, m),
  })

  const status =
    diff === 0
      ? t('fit.exact', { m: m + 1, ts: ts.join('/') })
      : t(diff > 0 ? 'fit.over' : 'fit.under', { m: m + 1, has: beats(total, unit), ts: ts.join('/'), need: beats(cap, unit), diff: beats(Math.abs(diff), unit) })

  return (
    <Modal open onClose={onClose} title={t('fit.title')} actions={<button className="btn" onClick={onClose}>{t('common.cancel')}</button>}>
      <p style={{ margin: 0 }} className={diff === 0 ? 'muted' : 'warn'}>{status}</p>
      <div className="stack" style={{ gap: 8 }}>
        {options.map((o) => (
          <button
            key={o.key}
            className="choice fit-option"
            onClick={() => {
              onApply(o.run())
              onClose()
            }}
          >
            <span>
              <strong>{o.title}</strong>
              <br />
              <span className="muted small">{o.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
