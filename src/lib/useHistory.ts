import { useCallback, useState } from 'react'

const LIMIT = 200

interface State<T> {
  past: T[]
  present: T
  future: T[]
}

/** Value with undo/redo. `reset` replaces the value and clears history (e.g. when switching documents). */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<State<T>>({ past: [], present: initial, future: [] })

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((s) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(s.present) : next
      if (value === s.present) return s
      return { past: [...s.past.slice(-(LIMIT - 1)), s.present], present: value, future: [] }
    })
  }, [])

  const undo = useCallback(() => {
    setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s))
  }, [])

  const redo = useCallback(() => {
    setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s))
  }, [])

  const reset = useCallback((v: T) => setState({ past: [], present: v, future: [] }), [])

  return { value: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }
}
