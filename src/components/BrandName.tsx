import { useTranslation } from 'react-i18next'

/** The app name, its capital letters in bold green. */
export function BrandName() {
  const { t } = useTranslation()
  return (
    <span>
      {t('app.name').split(/([A-Z])/).map((part, i) => (i % 2 ? <span key={i} className="brand-cap">{part}</span> : part))}
    </span>
  )
}
