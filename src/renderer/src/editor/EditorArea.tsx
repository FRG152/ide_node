import { useShallow } from 'zustand/react/shallow'
import { errorMessage } from '../lib/errors'
import { baseName, formatSize } from '../lib/paths'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { CodeEditor } from './CodeEditor'
import { getDocument, type Document } from './documents'
import { classes } from '../lib/classes'

function reportError(err: unknown): void {
  useProjectStore.getState().setError(errorMessage(err))
}

export function EditorArea() {
  const { tabs, active, dirty, activate, close } = useEditorStore(
    useShallow((s) => ({ tabs: s.tabs, active: s.active, dirty: s.dirty, activate: s.activate, close: s.close }))
  )
  const doc = active ? getDocument(active) : undefined

  return (
    <div className="editor-area">
      <div className="editor-tabs">
        {tabs.map((path) => (
          <div
            key={path}
            className={classes('editor-tab', path === active && 'active', !!dirty[path] && 'dirty')}
            title={path}
            onClick={() => activate(path)}
            // Clic central cierra, como en VS Code.
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                void close(path)
              }
            }}
          >
            <span className="editor-tab-name">{baseName(path)}</span>
            <button
              className="editor-tab-close"
              title={dirty[path] ? 'Cambios sin guardar' : 'Cerrar (Ctrl+W)'}
              onClick={(e) => {
                e.stopPropagation()
                void close(path)
              }}
            />
          </div>
        ))}
      </div>

      {active && (
        <div className="editor-pathbar">
          <span className="editor-path">{active}</span>
          <button onClick={() => void useProjectStore.getState().reveal(active)} title="Centrar este archivo en el grafo">
            Ver en grafo
          </button>
          <button onClick={() => window.api.revealPath(active).catch(reportError)} title="Mostrar en el explorador">
            Mostrar en carpeta
          </button>
        </div>
      )}

      <div className="editor-body">
        <CodeEditor path={doc?.kind === 'text' ? active : null} />
        {active && doc && doc.kind !== 'text' && <NotEditable path={active} doc={doc} />}
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
