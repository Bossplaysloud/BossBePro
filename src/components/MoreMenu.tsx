import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface MoreItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

/** A "⋯" button that opens a small menu of actions; closes on a choice, outside tap or Esc. */
export function MoreMenu({ items, label, children, className }: { items?: MoreItem[]; label?: string; children?: ReactNode; className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`more-menu${className ? ` ${className}` : ''}`}>
      <button className="btn btn-icon" aria-haspopup="menu" aria-expanded={open} aria-label={label ?? t('common.more')} title={label ?? t('common.more')} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="more-menu-pop" role="menu">
          {items?.map((x) => (
            <button
              key={x.label}
              role="menuitem"
              className={x.danger ? 'danger' : undefined}
              disabled={x.disabled}
              onClick={() => {
                setOpen(false)
                x.onClick()
              }}
            >
              <span>{x.label}</span>
              {x.icon}
            </button>
          ))}
          {children}
        </div>
      )}
    </div>
  )
}
