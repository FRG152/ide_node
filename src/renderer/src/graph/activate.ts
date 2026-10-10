import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'

/**
 * Clic (o pellizco con la mano) sobre un nodo, igual en las dos vistas del grafo: la carpeta
 * se abre o se cierra, el archivo se abre en el editor y "+N más" muestra el resto de `path`.
 */
export function activateNode(kind: 'folder' | 'file' | 'more', path: string): void {
  const { toggleFolder, select, showAllChildren } = useProjectStore.getState()
  if (kind === 'folder') {
    void toggleFolder(path)
  } else if (kind === 'file') {
    select(path)
    void useEditorStore.getState().open(path, 'center')
  } else {
    showAllChildren(path)
  }
}
