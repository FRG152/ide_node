import { useEffect } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { useZoomStore } from '../stores/zoomStore'

/** Ctrl +/= acerca, Ctrl - aleja, Ctrl 0 restablece (también en el teclado numérico). */
function zoomDirection(e: KeyboardEvent): 1 | -1 | 0 | null {
  if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') return 1
  if (e.key === '-' || e.code === 'NumpadSubtract') return -1
  if (e.key === '0' || e.code === 'Numpad0') return 0
  return null
}

/** Evento que escucha el buscador para enfocarse. */
export const FOCUS_SEARCH_EVENT = 'ide:focus-search'

/**
 * Atajos globales. Se escuchan en fase de captura para que tengan prioridad sobre
 * Monaco y xterm (que, si no, se quedarían Ctrl+P, Ctrl+S...).
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return

      // Zoom de toda la ventana, como en VS Code. Antes del filtro de Shift: en teclado
      // inglés "+" es Shift+"=".
      const zoom = zoomDirection(e)
      if (zoom !== null) {
        const store = useZoomStore.getState()
        if (zoom === 0) store.resetWindow()
        else store.zoomWindow(zoom)
        e.preventDefault()
        e.stopPropagation()
        return
      }

      if (e.shiftKey) return
      const key = e.key.toLowerCase()
      const editor = useEditorStore.getState()
      // Con el foco en la terminal (Claude Code, una shell...) solo nos quedamos Ctrl+J y Ctrl+I:
      // el resto (Ctrl+O, Ctrl+P, Ctrl+S...) son teclas que esos programas usan.
      const inTerminal = e.target instanceof Element && e.target.closest('.terminal-panel') !== null

      if (key === 'j') {
        // Como el "Toggle Panel" de VS Code.
        useTerminalStore.getState().togglePanel()
      } else if (key === 'i') {
        // Claude: el IDE gira en torno a él, así que tiene atajo propio.
        void useTerminalStore.getState().openClaude()
      } else if (inTerminal) {
        return
      } else if (key === 'p') {
        window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT))
      } else if (key === 'o') {
        void useProjectStore.getState().openFolder()
      } else if (key === 's') {
        if (editor.active) void editor.save(editor.active)
      } else if (key === 'w') {
        if (editor.active) void editor.close(editor.active)
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
