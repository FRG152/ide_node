import { ReactFlowProvider } from '@xyflow/react'
import { useEffect } from 'react'
import { FilePreview } from './components/FilePreview'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { ProjectGraph } from './graph/ProjectGraph'
import { useProjectStore } from './store'

export function App() {
  const project = useProjectStore((s) => s.project)
  const openFile = useProjectStore((s) => s.openFile)
  const openFolder = useProjectStore((s) => s.openFolder)

  useEffect(() => {
    void useProjectStore.getState().openInitialProject()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void openFolder()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openFolder])

  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
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
        {openFile !== null && <FilePreview key={openFile} path={openFile} />}
      </main>
      <StatusBar />
    </div>
  )
}
