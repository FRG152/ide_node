import { useEffect, useState } from 'react'
import type { FilePreview as Preview } from '../../../shared/ipc'
import { errorMessage } from '../lib/errors'
import { formatSize } from '../lib/paths'
import { useProjectStore } from '../store'

type LoadState = { status: 'loading' } | { status: 'ready'; preview: Preview } | { status: 'error'; message: string }

/** Panel de solo lectura con el contenido del archivo. Se monta con key={path}. */
export function FilePreview({ path }: { path: string }) {
  const closeFile = useProjectStore((s) => s.closeFile)
  const setError = useProjectStore((s) => s.setError)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    window.api.readFile(path).then(
      (preview) => !cancelled && setState({ status: 'ready', preview }),
      (err) => !cancelled && setState({ status: 'error', message: errorMessage(err) })
    )
    return () => {
      cancelled = true
    }
  }, [path])

  const openWithSystem = async (): Promise<void> => {
    try {
      const failure = await window.api.openPath(path)
      if (failure) setError(`No se pudo abrir "${path}": ${failure}`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const revealInFolder = (): void => {
    window.api.revealPath(path).catch((err) => setError(errorMessage(err)))
  }

  return (
    <aside className="preview">
      <header className="preview-header">
        <div className="preview-title">
          <span className="preview-path" title={path}>
            {path}
          </span>
          {state.status === 'ready' && <span className="preview-size">{formatSize(state.preview.size)}</span>}
        </div>
        <div className="preview-actions">
          <button onClick={openWithSystem} title="Abrir con la aplicación predeterminada del sistema">
            Abrir
          </button>
          <button onClick={revealInFolder} title="Mostrar en el explorador de archivos">
            Mostrar en carpeta
          </button>
          <button onClick={closeFile} title="Cerrar vista previa">
            ✕
          </button>
        </div>
      </header>

      {state.status === 'loading' && <div className="preview-message">Cargando…</div>}
      {state.status === 'error' && <div className="preview-message error">{state.message}</div>}
      {state.status === 'ready' && state.preview.kind === 'binary' && (
        <div className="preview-message">Archivo binario: no se puede previsualizar.</div>
      )}
      {state.status === 'ready' && state.preview.kind === 'text' && (
        <>
          {state.preview.truncated && (
            <div className="preview-message">Archivo grande: se muestra solo el principio.</div>
          )}
          <pre className="preview-code">{state.preview.content}</pre>
        </>
      )}
    </aside>
  )
}
