import { ReactFlowProvider } from '@xyflow/react'
import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { EditorArea } from './editor/EditorArea'
import { ProjectGraph } from './graph/ProjectGraph'
import { useGlobalShortcuts } from './lib/shortcuts'
import { useEditorStore } from './stores/editorStore'
import { useProjectStore } from './stores/projectStore'
import { useTerminalStore } from './stores/terminalStore'
import { TerminalPanel } from './terminal/TerminalPanel'

export function App() {
  const project = useProjectStore((s) => s.project)
  const openFolder = useProjectStore((s) => s.openFolder)
  const hasTabs = useEditorStore((s) => s.tabs.length > 0)
  const terminalOpen = useTerminalStore((s) => s.panelOpen)

  useGlobalShortcuts()

  useEffect(() => {
    void useProjectStore.getState().openInitialProject()
  }, [])

  useEffect(() => window.api.onFsChanges((changes) => void useProjectStore.getState().applyFsChanges(changes)), [])

  // Con cambios sin guardar, bloqueamos cerrar/recargar; el main pregunta al usuario.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (Object.keys(useEditorStore.getState().dirty).length === 0) return
      e.preventDefault()
      e.returnValue = true
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return (
    <div className="app">
      <Toolbar />
      <Group orientation="vertical" className="workspace">
        <Panel id="main" minSize={120}>
          <Group orientation="horizontal">
            <Panel id="graph" minSize={200}>
              <section className="canvas">
                {project ? (
                  <ReactFlowProvider key={project.rootPath}>
                    <ProjectGraph />
                  </ReactFlowProvider>
                ) : (
                  <div className="welcome">
                    <p>Abre una carpeta para ver su estructura como un grafo de nodos.</p>
                    <button onClick={() => void openFolder()}>Abrir carpeta (Ctrl+O)</button>
                  </div>
                )}
              </section>
            </Panel>
            {hasTabs && (
              <>
                <Separator className="separator separator-vertical" />
                <Panel id="editor" defaultSize="55" minSize={280}>
                  <EditorArea />
                </Panel>
              </>
            )}
          </Group>
        </Panel>
        {project && terminalOpen && (
          <>
            <Separator className="separator separator-horizontal" />
            <Panel id="terminal" defaultSize="35" minSize={80}>
              <TerminalPanel />
            </Panel>
          </>
        )}
      </Group>
      <StatusBar />
    </div>
  )
}
