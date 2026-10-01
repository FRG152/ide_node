import { useMemo } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { DEFAULT_FONT_SIZE, useZoomStore, windowZoomPercent, type ZoomTarget } from '../stores/zoomStore'

export function StatusBar() {
  const project = useProjectStore((s) => s.project)
  const index = useProjectStore((s) => s.index)
  const indexing = useProjectStore((s) => s.indexing)
  const truncated = useProjectStore((s) => s.indexTruncated)
  const error = useProjectStore((s) => s.error)
  const setError = useProjectStore((s) => s.setError)
  const unsaved = useEditorStore((s) => Object.keys(s.dirty).length)
  const { windowLevel, fontSize, resetWindow, resetFont } = useZoomStore()

  const fileCount = useMemo(() => index.filter((e) => e.kind === 'file').length, [index])

  return (
    <footer className="statusbar">
      <span>
        {!project
          ? 'Listo'
          : indexing
            ? 'Indexando proyecto…'
            : `${fileCount} archivos · ${index.length - fileCount} carpetas${truncated ? ' (índice incompleto)' : ''}`}
      </span>
      <span className="statusbar-right">
        {unsaved > 0 && <span>● {unsaved} sin guardar</span>}
        {windowLevel !== 0 && (
          <button className="statusbar-item" onClick={resetWindow} title="Restablecer zoom (Ctrl+0)">
            Zoom {windowZoomPercent(windowLevel)}%
          </button>
        )}
        {(['editor', 'terminal'] as ZoomTarget[])
          .filter((target) => fontSize[target] !== DEFAULT_FONT_SIZE)
          .map((target) => (
            <button
              key={target}
              className="statusbar-item"
              onClick={() => resetFont(target)}
              title="Letra cambiada con Ctrl+rueda. Clic para restablecer."
            >
              {target === 'editor' ? 'Editor' : 'Terminal'} {Math.round((fontSize[target] / DEFAULT_FONT_SIZE) * 100)}%
            </button>
          ))}
      </span>
      {error && (
        <span className="statusbar-error">
          {error}
          <button onClick={() => setError(null)} title="Descartar">
            ✕
          </button>
        </span>
      )}
    </footer>
  )
}
