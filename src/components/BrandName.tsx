import { useTranslation } from 'react-i18next'

/** The app name in the brush script, its capital letters in green. */
export function BrandName() {
  const { t } = useTranslation()
  return (
    <span className="brand-name">
      {t('app.name').split(/([A-Z])/).map((part, i) => (i % 2 ? <span key={i} className="brand-cap">{part}</span> : part))}
    </span>
  )
}
