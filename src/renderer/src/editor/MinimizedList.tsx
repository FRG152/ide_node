import { useShallow } from 'zustand/react/shallow'
import { useT } from '../i18n'
import { colorForFile } from '../lib/fileColors'
import { baseName, parentOf } from '../lib/paths'
import { useEditorStore } from '../stores/editorStore'

/** Archivos minimizados, a la derecha, de arriba abajo en el orden en que se minimizaron. */
export function MinimizedList() {
  const t = useT()
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
          title={t('minimized.title', { path })}
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
              {dirty[path] && <span title={t('editor.unsaved')}> ●</span>}
            </span>
            <span className="minimized-dir">{parentOf(path)}</span>
          </span>
          <button
            className="minimized-close"
            title={t('minimized.close')}
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
