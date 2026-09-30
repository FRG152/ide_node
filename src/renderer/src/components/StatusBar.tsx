import { useMemo } from 'react'
import { useProjectStore } from '../store'

export function StatusBar() {
  const project = useProjectStore((s) => s.project)
  const index = useProjectStore((s) => s.index)
  const indexing = useProjectStore((s) => s.indexing)
  const truncated = useProjectStore((s) => s.indexTruncated)
  const error = useProjectStore((s) => s.error)
  const setError = useProjectStore((s) => s.setError)

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
