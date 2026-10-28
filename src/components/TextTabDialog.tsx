import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabContent } from '../music/tab'
import { appendMeasures, parseTextTab, tabToText } from '../music/textTab'
import { Modal } from './Modal'
import { useToast } from './Toast'

interface Props {
  open: boolean
  onClose: () => void
  content: TabContent
  tuning: number[]
  timeSignature: [number, number]
  onApply: (next: TabContent) => void
}

/** Paste/type plain-text TAB to import it, or copy the current sheet as text. */
export function TextTabDialog({ open, onClose, content, tuning, timeSignature, onApply }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const [tab, setTab] = useState<'import' | 'export'>('import')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const strings = tuning.length

  const parsed = useMemo(() => (text.trim() ? parseTextTab(text, strings, timeSignature) : null), [text, strings, timeSignature])
  const mismatch = parsed?.blockStrings.find((n) => n !== strings)
  const exported = useMemo(() => (open && tab === 'export' ? tabToText(content, tuning) : ''), [open, tab, content, tuning])

  const apply = () => {
    if (!parsed?.measures.length) return
    onApply(appendMeasures(content, parsed.measures, mode === 'replace'))
    toast(t('textTab.imported', { count: parsed.measures.length }))
    setText('')
    onClose()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported)
      toast(t('textTab.copied'))
    } catch {
      toast(t('textTab.copyFailed'))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('textTab.title')}
      wide
      actions={
        tab === 'import' ? (
          <>
            <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-primary" disabled={!parsed?.measures.length} onClick={apply}>{t('textTab.apply')}</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>{t('common.close')}</button>
            <button className="btn btn-primary" onClick={() => void copy()}>{t('textTab.copy')}</button>
          </>
        )
      }
    >
      <div className="segmented" role="tablist">
        <button role="tab" aria-pressed={tab === 'import'} aria-selected={tab === 'import'} onClick={() => setTab('import')}>{t('textTab.import')}</button>
        <button role="tab" aria-pressed={tab === 'export'} aria-selected={tab === 'export'} onClick={() => setTab('export')}>{t('textTab.export')}</button>
      </div>

      {tab === 'import' ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>{t('textTab.hint')}</p>
          <textarea
            className="input mono"
            rows={10}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={'e|---0---3h5---|\nB|-1-----------|\nG|---------7b9-|'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {parsed && (
            <p className="small" style={{ margin: 0 }}>
              {parsed.measures.length
                ? t('textTab.preview', { measures: parsed.measures.length, notes: parsed.noteCount })
                : t('textTab.nothing')}
              {mismatch !== undefined && <span className="warn"> · {t('textTab.mismatch', { found: mismatch, strings })}</span>}
            </p>
          )}
          <div className="row">
            {(['append', 'replace'] as const).map((m) => (
              <label key={m} className="row small" style={{ gap: 6 }}>
                <input type="radio" name="text-tab-mode" checked={mode === m} onChange={() => setMode(m)} />
                {t(`textTab.${m}`)}
              </label>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>{t('textTab.rhythmNote')}</p>
        </>
      ) : (
        <textarea className="input mono" rows={12} readOnly value={exported} onFocus={(e) => e.target.select()} />
      )}
    </Modal>
  )
}
