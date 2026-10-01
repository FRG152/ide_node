import { ReactFlowProvider } from '@xyflow/react'
import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { ClaudeBar } from './claude/ClaudeBar'
import './claude/ideCommands' // ejecuta en la interfaz las acciones que pide Claude
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { EditorWindow } from './editor/EditorWindow'
import { MinimizedList } from './editor/MinimizedList'
import { ProjectGraph } from './graph/ProjectGraph'
import { useT } from './i18n'
import { useGlobalShortcuts } from './lib/shortcuts'
import { useEditorStore } from './stores/editorStore'
import { useProjectStore } from './stores/projectStore'
import { useTerminalStore } from './stores/terminalStore'
import { TerminalPanel } from './terminal/TerminalPanel'

export function App() {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const openFolder = useProjectStore((s) => s.openFolder)
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
          {/* El grafo ocupa todo; el editor, los minimizados y Claude flotan encima. */}
          <section className="canvas">
            {project ? (
              <>
                <ReactFlowProvider key={project.rootPath}>
                  <ProjectGraph />
                </ReactFlowProvider>
                <MinimizedList />
                <EditorWindow />
                <ClaudeBar />
              </>
            ) : (
              <div className="welcome">
                <div className="welcome-mark">✻</div>
                <p>{t('welcome.text')}</p>
                <button className="primary" onClick={() => void openFolder()}>
                  {t('welcome.button')}
                </button>
              </div>
            )}
          </section>
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
