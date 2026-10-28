import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { findVoicings, parseChord, voicingLabel, type Voicing } from '../music/chords'
import { noteName } from '../music/instruments'
import { ChordDiagram } from './ChordDiagram'
import { Modal } from './Modal'

interface Props {
  open: boolean
  initial?: string
  /** Chord names already used in this sheet, offered as quick picks. */
  used: string[]
  tuning: number[]
  frets: number
  onClose: () => void
  onSetName: (name: string | null) => void
  /** Offered only where a shape can be written (TAB). */
  onApplyShape?: (name: string, voicing: Voicing) => void
}

export function ChordDialog({ open, initial = '', used, tuning, frets, onClose, onSetName, onApplyShape }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setName(initial)
  }

  const chord = useMemo(() => (name.trim() ? parseChord(name) : null), [name])
  const voicings = useMemo(() => (chord && onApplyShape ? findVoicings(chord, tuning, frets, 8) : []), [chord, tuning, frets, onApplyShape])
  const tones = chord
    ? [...chord.degrees.entries()].sort((a, b) => a[0] - b[0]).map(([i, d]) => `${noteName(chord.root + i)}(${d})`).join(' ')
    : ''

  const setOnly = () => {
    if (!chord) return
    onSetName(name.trim())
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('chord.title')}
      wide
      actions={
        <>
          {initial && (
            <button className="btn btn-danger" onClick={() => (onSetName(null), onClose())}>{t('chord.remove')}</button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!chord} onClick={setOnly}>{t('chord.nameOnly')}</button>
        </>
      }
    >
      <input
        className="input"
        value={name}
        autoFocus
        placeholder={t('chord.placeholder')}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && setOnly()}
      />
      {used.length > 0 && (
        <div className="row">
          {used.map((u) => (
            <button key={u} className="btn chip" onClick={() => setName(u)}>{u}</button>
          ))}
        </div>
      )}
      <p className={`small ${name.trim() && !chord ? 'warn' : 'muted'}`} style={{ margin: 0 }}>
        {!name.trim() ? t('chord.hint') : chord ? `${t('chord.tones')}：${tones}` : t('chord.invalid')}
      </p>
      {chord && onApplyShape && (
        <>
          <div className="small muted">{voicings.length ? t('chord.shapes') : t('chord.noShapes')}</div>
          <div className="voicing-grid">
            {voicings.map((v) => (
              <button key={v.frets.join()} className="voicing" onClick={() => (onApplyShape(name.trim(), v), onClose())} title={t('chord.applyShape')}>
                <ChordDiagram voicing={v} />
                <span className="small">{voicingLabel(v)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
