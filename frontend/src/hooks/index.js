import { useState, useEffect, useCallback } from 'react'

export function useToast() {
  const [toasts, setToasts] = useState([])

  const add = useCallback((msg, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  return { toasts, add }
}

export function useKeyboardShortcut(key, callback, { meta = false, ctrl = false } = {}) {
  useEffect(() => {
    const handler = (e) => {
      if (meta && !e.metaKey) return
      if (ctrl && !e.ctrlKey) return
      if (e.key === key) { e.preventDefault(); callback() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [key, callback, meta, ctrl])
}