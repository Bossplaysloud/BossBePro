import { useEffect, useRef } from 'react'
import { updateSheet } from '../db/repo'
import { registerFlush } from './pendingSaves'

const SAVE_DELAY = 400

/** Debounced save of a sheet's content; flushes on unmount and when the page is hidden (app switch on mobile). */
export function useAutosave(sheetId: string, content: unknown, initial: unknown) {
  const pending = useRef<unknown>(null)
  useEffect(() => {
    if (content === initial) return
    pending.current = content
    const timer = setTimeout(() => {
      pending.current = null
      void updateSheet(sheetId, { content })
    }, SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [content, initial, sheetId])
  useEffect(() => {
    const flush = async () => {
      const content = pending.current
      pending.current = null
      if (content) await updateSheet(sheetId, { content })
    }
    const onHide = () => document.visibilityState === 'hidden' && void flush()
    document.addEventListener('visibilitychange', onHide)
    const unregister = registerFlush(flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      unregister()
      void flush()
    }
  }, [sheetId])
}
