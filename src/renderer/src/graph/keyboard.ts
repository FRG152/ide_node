/**
 * Modo teclado del grafo: moverse por el árbol como en el explorador de VS Code.
 *
 * ↑/↓ hermano anterior/siguiente · → expande o baja al primer hijo · ← colapsa o sube al
 * padre · Enter abre el archivo (o expande/colapsa la carpeta) · Inicio: raíz. Dentro de una
 * cuadrícula de hermanos, ← / → sobre un archivo pasan a la columna de al lado.
 */
import { parentOf } from '../lib/paths'
import type { GridNeighbors } from './buildGraph'
import { useEditorStore } from '../stores/editorStore'
import { MAX_VISIBLE_CHILDREN, useProjectStore } from '../stores/projectStore'

/** Evento para dar el foco al grafo y entrar en modo teclado (Ctrl+Shift+E, Esc desde el editor). */
export const FOCUS_GRAPH_EVENT = 'ide:focus-graph'
/** Evento para dar el foco al editor (Enter sobre el archivo que ya estaba abierto). */
export const FOCUS_EDITOR_EVENT = 'ide:focus-editor'

/** Teclas de navegación (sin modificadores). Devuelve false si la tecla no es del modo teclado. */
export function handleGraphKey(key: string, gridNeighbors: Record<string, GridNeighbors>): boolean {
  const project = useProjectStore.getState()
  const { entries, children, expanded, showAll } = project
  const selected = project.selected ?? ''
  const entry = entries[selected]
  if (!entry) {
    project.focus('', { quick: true })
    return true
  }
  const isDir = entry.kind === 'directory'
  const grid = gridNeighbors[selected]

  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      if (selected === '') return true
      const parent = parentOf(selected)
      const siblings = children[parent] ?? []
      const next = siblings.indexOf(selected) + (key === 'ArrowDown' ? 1 : -1)
      if (next < 0 || next >= siblings.length) return true
      // Pasado el último hijo visible ("+N more"), mostramos el resto de la carpeta.
      if (next >= MAX_VISIBLE_CHILDREN && !showAll[parent]) project.showAllChildren(parent)
      project.focus(siblings[next], { quick: true })
      return true
    }

    case 'ArrowRight':
      if (!isDir) {
        if (grid?.right) project.focus(grid.right, { quick: true })
        return true
      }
      if (!expanded[selected]) void project.toggleFolder(selected)
      else if (children[selected]?.length) project.focus(children[selected][0], { quick: true })
      return true

    case 'ArrowLeft':
      if (isDir && expanded[selected] && selected !== '') void project.toggleFolder(selected)
      else if (grid?.left) project.focus(grid.left, { quick: true })
      else if (selected !== '') project.focus(parentOf(selected), { quick: true })
      return true

    case 'Enter':
      if (isDir) {
        void project.toggleFolder(selected)
      } else if (useEditorStore.getState().active === selected) {
        window.dispatchEvent(new Event(FOCUS_EDITOR_EVENT))
      } else {
        void useEditorStore.getState().open(selected, 'center')
      }
      return true

    case 'Home':
      project.focus('', { quick: true })
      return true

    default:
      return false
  }
}
