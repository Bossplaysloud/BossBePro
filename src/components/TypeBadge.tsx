import { useTranslation } from 'react-i18next'
import type { CSSProperties } from 'react'
import type { SheetType } from '../db/db'

export function TypeBadge({ type }: { type: SheetType }) {
  const { t } = useTranslation()
  return (
    <span className="type-badge" style={{ '--c': `var(--type-${type})` } as CSSProperties}>
      {t(`sheetType.${type}`)}
    </span>
  )
}
