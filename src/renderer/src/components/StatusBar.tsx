import { useMemo } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'

export function StatusBar() {
  const project = useProjectStore((s) => s.project)
  const index = useProjectStore((s) => s.index)
  const indexing = useProjectStore((s) => s.indexing)
  const truncated = useProjectStore((s) => s.indexTruncated)
  const error = useProjectStore((s) => s.error)
  const setError = useProjectStore((s) => s.setError)
  const unsaved = useEditorStore((s) => Object.keys(s.dirty).length)

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
      {unsaved > 0 && <span>● {unsaved} sin guardar</span>}
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
