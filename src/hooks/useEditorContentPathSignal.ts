import { useEffect, useState } from 'react'

export interface EditorContentPathSignal {
  path: string | null
  version: number
}

export function useEditorContentPathSignal(activePath?: string | null): EditorContentPathSignal {
  const [contentSignal, setContentSignal] = useState<EditorContentPathSignal>({ path: null, version: 0 })

  useEffect(() => {
    const handleTabSwapped = (event: Event) => {
      const path = event instanceof CustomEvent && typeof event.detail?.path === 'string'
        ? event.detail.path
        : null
      if (path && (activePath === undefined || path === activePath)) {
        setContentSignal((current) => ({ path, version: current.version + 1 }))
      }
    }

    window.addEventListener('laputa:editor-tab-swapped', handleTabSwapped)
    return () => { window.removeEventListener('laputa:editor-tab-swapped', handleTabSwapped); }
  }, [activePath])

  return contentSignal
}
