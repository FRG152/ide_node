import { useShallow } from 'zustand/react/shallow'
import { colorForFile } from '../lib/fileColors'
import { baseName, parentOf } from '../lib/paths'
import { useEditorStore } from '../stores/editorStore'

/** Archivos minimizados, a la derecha, de arriba abajo en el orden en que se minimizaron. */
export function MinimizedList() {
  const { minimized, dirty, open, close } = useEditorStore(
    useShallow((s) => ({ minimized: s.minimized, dirty: s.dirty, open: s.open, close: s.close }))
  )
  if (minimized.length === 0) return null

  return (
    <ul className="minimized-list">
      {minimized.map((path) => (
        <li
          key={path}
          className="minimized-item"
          style={{ borderLeftColor: colorForFile(path) }}
          title={`${path}\nClic para abrir · clic central para cerrar`}
          onClick={() => void open(path, 'center')}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              void close(path)
            }
          }}
        >
          <span className="minimized-text">
            <span className="minimized-name">
              {baseName(path)}
              {dirty[path] && <span title="Cambios sin guardar"> ●</span>}
            </span>
            <span className="minimized-dir">{parentOf(path)}</span>
          </span>
          <button
            className="minimized-close"
            title="Cerrar"
            onClick={(e) => {
              e.stopPropagation()
              void close(path)
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
