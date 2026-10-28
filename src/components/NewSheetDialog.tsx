import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { db, SHEET_TYPES, type SheetType } from '../db/db'
import { createImageSheet, createSheet } from '../db/repo'
import { pickSheetFiles } from '../lib/pickFiles'
import { Icon } from './Icon'
import { defaultTuning } from '../music/instruments'
import { Modal } from './Modal'
import { TuningPicker, type TuningValue } from './TuningPicker'

export function NewSheetDialog({ open, onClose, sectionId }: { open: boolean; onClose: () => void; sectionId: string | null }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const sections = useLiveQuery(() => db.sections.orderBy('order').toArray(), []) ?? []
  const [title, setTitle] = useState('')
  const [type, setType] = useState<SheetType>('tab')
  const [section, setSection] = useState<string | null>(sectionId)
  const [tuning, setTuning] = useState<TuningValue>({ instrument: 'guitar', tuning: defaultTuning('guitar', 6) })
  const [files, setFiles] = useState<File[]>([])
  const [prevOpen, setPrevOpen] = useState(open)

  // Reset the form each time the dialog opens.
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setTitle('')
      setSection(sectionId)
      setFiles([])
    }
  }

  const submit = async () => {
    if (type === 'image') {
      // A picture / PDF sheet needs its files; its title defaults to the first file's name.
      if (!files.length) return pickSheetFiles(setFiles)
      const id = await createImageSheet({ title: title.trim() || files[0].name.replace(/\.[^.]+$/, ''), sectionId: section, files })
      onClose()
      navigate(`/sheet/${id}`)
      return
    }
    const id = await createSheet({
      title: title.trim() || t('common.untitled'),
      type,
      sectionId: section,
      instrument: tuning.instrument,
      strings: tuning.tuning.length,
      tuning: tuning.tuning,
    })
    onClose()
    navigate(`/sheet/${id}`)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('sheet.new')}
      actions={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={type === 'image' && !files.length} onClick={() => void submit()}>{t('common.create')}</button>
        </>
      }
    >
      <label className="field">
        <span>{t('sheet.title')}</span>
        <input className="input" value={title} placeholder={t('sheet.titlePlaceholder')} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>{t('sheet.type')}</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as SheetType)}>
            {[...SHEET_TYPES, 'image' as const].map((x) => (
              <option key={x} value={x}>{t(`sheetType.${x}`)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('sheet.section')}</span>
          <select className="select" value={section ?? ''} onChange={(e) => setSection(e.target.value || null)}>
            <option value="">{t('nav.unsorted')}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>
      {type === 'image' ? (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>{t('imageSheet.newHint')}</p>
          <div className="row">
            <button className="btn" onClick={() => pickSheetFiles((f) => setFiles((old) => [...old, ...f]))}>
              <Icon name="upload" />
              {t('imageSheet.chooseFiles')}
            </button>
            <span className="small muted">{files.length ? files.map((f) => f.name).join('、') : t('imageSheet.noFiles')}</span>
          </div>
        </div>
      ) : (
        <TuningPicker value={tuning} onChange={setTuning} />
      )}
    </Modal>
  )
}
