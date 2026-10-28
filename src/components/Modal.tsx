import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  actions: ReactNode
  /** Prevent closing with Esc / backdrop click (e.g. while an operation runs). */
  locked?: boolean
  wide?: boolean
}

export function Modal({ open, onClose, title, children, actions, locked, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' wide' : ''}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        if (!locked) onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current && !locked) onClose()
      }}
    >
      {open && (
        <>
          <div className="modal-body">
            <h2>{title}</h2>
            {children}
          </div>
          <div className="modal-actions">{actions}</div>
        </>
      )}
    </dialog>
  )
}

interface ConfirmProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmModal({ open, title, body, confirmLabel, cancelLabel, danger, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>{cancelLabel}</button>
          <button className={`btn btn-primary${danger ? ' btn-danger' : ''}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{body}</p>
    </Modal>
  )
}

interface PromptProps {
  open: boolean
  title: string
  initial?: string
  placeholder?: string
  confirmLabel: string
  cancelLabel: string
  onSubmit: (value: string) => void
  onClose: () => void
}

export function PromptModal({ open, title, initial = '', placeholder, confirmLabel, cancelLabel, onSubmit, onClose }: PromptProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const submit = () => {
    const v = inputRef.current?.value.trim()
    if (v) onSubmit(v)
  }
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>{cancelLabel}</button>
          <button className="btn btn-primary" onClick={submit}>{confirmLabel}</button>
        </>
      }
    >
      <input
        ref={inputRef}
        className="input"
        defaultValue={initial}
        placeholder={placeholder}
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
    </Modal>
  )
}
