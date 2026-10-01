import type { KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { errorMessage } from '../lib/errors'
import { colorForFile } from '../lib/fileColors'
import { baseName, formatSize, parentOf } from '../lib/paths'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { CodeEditor } from './CodeEditor'
import { getDocument, type Document } from './documents'

function reportError(err: unknown): void {
  useProjectStore.getState().setError(errorMessage(err))
}

/** Ventana flotante centrada sobre el grafo con el archivo activo. */
export function EditorWindow() {
  const { active, dirty, minimize, close } = useEditorStore(
    useShallow((s) => ({
      active: s.active,
      dirty: s.active !== null && s.dirty[s.active] === true,
      minimize: s.minimize,
      close: s.close
    }))
  )
  if (!active) return null
  const doc = getDocument(active)

  // Esc minimiza. Llega aquí solo si Monaco no lo usó (cerrar el buscador, sugerencias...),
  // porque en ese caso detiene la propagación.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !e.defaultPrevented) minimize()
  }

  return (
    <div className="editor-window" data-path={active} onKeyDown={onKeyDown}>
      <header className="editor-window-header" style={{ borderTopColor: colorForFile(active) }}>
        <span className="editor-window-name">
          {baseName(active)}
          {dirty && <span className="editor-window-dirty" title="Cambios sin guardar"> ●</span>}
        </span>
        <span className="editor-window-dir" title={active}>
          {parentOf(active)}
        </span>
        <button onClick={() => window.api.revealPath(active).catch(reportError)} title="Mostrar en el explorador">
          Mostrar en carpeta
        </button>
        <button className="editor-window-icon" onClick={minimize} title="Minimizar (Esc)">
          —
        </button>
        <button className="editor-window-icon" onClick={() => void close(active)} title="Cerrar (Ctrl+W)">
          ×
        </button>
      </header>
      <div className="editor-body">
        <CodeEditor path={doc?.kind === 'text' ? active : null} />
        {doc && doc.kind !== 'text' && <NotEditable path={active} doc={doc} />}
      </div>
    </div>
  )
}

function NotEditable({ path, doc }: { path: string; doc: Exclude<Document, { kind: 'text' }> }) {
  const openWithSystem = async (): Promise<void> => {
    try {
      const failure = await window.api.openPath(path)
      if (failure) useProjectStore.getState().setError(`No se pudo abrir "${path}": ${failure}`)
    } catch (err) {
      reportError(err)
    }
  }

  return (
    <div className="editor-message">
      <p>
        {doc.kind === 'binary' && `Archivo binario (${formatSize(doc.size)}): no se puede editar aquí.`}
        {doc.kind === 'too-large' && `Archivo demasiado grande para el editor (${formatSize(doc.size)}).`}
        {doc.kind === 'error' && `No se pudo abrir: ${doc.message}`}
      </p>
      {doc.kind !== 'error' && <button onClick={openWithSystem}>Abrir con la aplicación del sistema</button>}
    </div>
  )
}
