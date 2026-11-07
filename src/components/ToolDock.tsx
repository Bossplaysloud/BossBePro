import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useDockOpen, useDockTab } from '../lib/settings'
import { Icon } from './Icon'

export interface DockTab {
  id: string
  label: string
  content: ReactNode
}

/**
 * Phones: the editing tools in a panel fixed to the bottom of the screen, one tab at a time.
 * It can be folded away to a small button; the open state and the last used tab are remembered.
 * It sits just above the on-screen keyboard when one is open.
 */
export function ToolDock({ tabs, status, label, openLabel, badge, open: openProp, onOpen, tabState, children }: {
  tabs?: DockTab[]
  /** A line above the tabs, e.g. the cursor position. */
  status?: ReactNode
  /** Name of the panel, for screen readers. */
  label: string
  /** The folded button's text. */
  openLabel: string
  badge?: string
  /** Controlled open state; the remembered one is used when left out. */
  open?: boolean
  onOpen?: (open: boolean) => void
  /** Own tab memory instead of the shared one. */
  tabState?: [string | null, (tab: string) => void]
  /** A single toolbar instead of tabs. */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [savedOpen, setSavedOpen] = useDockOpen()
  const open = openProp ?? savedOpen
  const setOpen = onOpen ?? setSavedOpen
  const sharedTab = useDockTab()
  const [savedTab, setTab] = tabState ?? sharedTab
  const active = tabs?.find((x) => x.id === savedTab) ?? tabs?.[0]
  const activeId = active?.id
  const hasTabs = !!tabs
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyMin, setBodyMin] = useState(0)
  const lift = useKeyboardLift()

  // Leave room at the end of the page so the dock never covers it (see `.page::after`).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return setHeight(0)
    const update = () => setHeight(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])
  // Switching tabs keeps the tab bar in place: the body never shrinks below the tallest tab seen.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el || !hasTabs) return
    const h = el.scrollHeight
    if (h > bodyMin) setBodyMin(h)
  }, [activeId, open, hasTabs, bodyMin])
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--dock-space', `${open ? height + 12 : 72}px`)
    return () => void root.style.removeProperty('--dock-space')
  }, [open, height])

  const dock = open ? (
    <div ref={ref} className="tool-dock" role="region" aria-label={label} style={lift ? { bottom: lift } : undefined}>
      {(status || tabs) && (
        <div className="tool-dock-head">
          <span className="tool-dock-status muted small">{status}</span>
          <button className="btn tool-dock-close" onClick={() => setOpen(false)} aria-label={t('dock.hide')} title={t('dock.hide')}>
            {t('dock.hide')}
            <Icon name="chevron" />
          </button>
        </div>
      )}
      {tabs && (
        <div className="tool-dock-tabs" role="tablist">
          {tabs.map((x) => (
            <button key={x.id} role="tab" aria-selected={x.id === active?.id} onClick={() => setTab(x.id)}>{x.label}</button>
          ))}
        </div>
      )}
      <div ref={bodyRef} className={`tool-dock-body${!tabs && !status ? ' single' : ''}`} style={tabs && bodyMin ? { minHeight: bodyMin } : undefined}>
        {active?.content}
        {children}
        {!tabs && !status && (
          <button className="btn btn-icon tool-dock-close-icon" onClick={() => setOpen(false)} aria-label={t('dock.hide')} title={t('dock.hide')}>
            <Icon name="chevron" />
          </button>
        )}
      </div>
    </div>
  ) : (
    <button className="tool-dock-fab" style={lift ? { bottom: lift + 18 } : undefined} onClick={() => setOpen(true)}>
      {openLabel}
      {badge && <span className="muted"> · {badge}</span>}
      <span className="tool-dock-fab-icon"><Icon name="chevron" /></span>
    </button>
  )

  return createPortal(dock, document.body)
}

/** How far the on-screen keyboard covers the bottom of the layout viewport (0 when closed). */
function useKeyboardLift() {
  const [lift, setLift] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setLift(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return lift
}
