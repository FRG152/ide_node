import { useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'

/** Evento que escucha el buscador para enfocarse. */
export const FOCUS_SEARCH_EVENT = 'ide:focus-search'

/**
 * Atajos globales. Se escuchan en fase de captura para que tengan prioridad sobre
 * Monaco y xterm (que, si no, se quedarían Ctrl+P, Ctrl+S...).
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      const editor = useEditorStore.getState()

      if (key === 'p') {
        window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT))
      } else if (key === 'o') {
        void useProjectStore.getState().openFolder()
      } else if (key === 's') {
        if (editor.active) void editor.save(editor.active)
      } else if (key === 'w') {
        if (editor.active) void editor.close(editor.active)
      } else if (key === 'ñ' || e.code === 'Backquote') {
        // Ctrl+Ñ en teclado español (como VS Code), Ctrl+` en inglés.
        useTerminalStore.getState().togglePanel()
      } else {
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
