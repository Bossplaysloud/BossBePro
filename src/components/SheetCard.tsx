import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Sheet } from '../db/db'
import { tuningLabel } from '../music/instruments'
import { isImageSheetContent } from '../music/imageSheet'
import { Icon } from './Icon'
import { useSortableItem } from './Sortable'
import { TypeBadge } from './TypeBadge'

/** With `selection`, the card is a checkbox: clicking it selects instead of opening the sheet. */
export function SheetCard({ sheet, sectionName, selection }: { sheet: Sheet; sectionName?: string; selection?: { selected: boolean; onToggle: () => void } }) {
  const { t, i18n } = useTranslation()
  const { ref, style, isDragging, handleProps } = useSortableItem(sheet.id)
  const date = new Date(sheet.updatedAt).toLocaleDateString(i18n.language)
  return (
    <Link
      ref={ref}
      style={style}
      to={`/sheet/${sheet.id}`}
      className={`sheet-card${isDragging ? ' dragging' : ''}${selection?.selected ? ' selected' : ''}`}
      aria-pressed={selection ? selection.selected : undefined}
      onClick={
        selection &&
        ((e) => {
          e.preventDefault()
          selection.onToggle()
        })
      }
    >
      {selection && <input type="checkbox" className="sheet-check" checked={selection.selected} readOnly tabIndex={-1} aria-label={sheet.title} />}
      <div className="body">
        <div className="title">{sheet.title}</div>
        <div className="meta">
          <TypeBadge type={sheet.type} />
          {sheet.type === 'image' ? ` · ${t('imageSheet.files', { count: isImageSheetContent(sheet.content) ? sheet.content.pages.length : 0 })}` : ` · ${t(`instrument.${sheet.instrument}`)} ${tuningLabel(sheet.tuning)}`}
        </div>
        <div className="meta">
          {sectionName ? `${sectionName} · ` : ''}
          {t('sheet.updated', { date })}
        </div>
        {sheet.tags.length > 0 && (
          <div className="tags">
            {sheet.tags.map((tag) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
      {!selection && (
        <span className="grip" {...handleProps} aria-label={t('sheet.dragHandle')} onClick={(e) => e.preventDefault()}>
          <Icon name="grip" />
        </span>
      )}
    </Link>
  )
}
