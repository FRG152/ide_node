import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { SearchBar } from './SearchBar'

export function Toolbar() {
  const project = useProjectStore((s) => s.project)
  const openFolder = useProjectStore((s) => s.openFolder)
  const collapseAll = useProjectStore((s) => s.collapseAll)
  const refresh = useProjectStore((s) => s.refresh)
  const terminalOpen = useTerminalStore((s) => s.panelOpen)
  const togglePanel = useTerminalStore((s) => s.togglePanel)

  return (
    <header className="toolbar">
      <button onClick={() => void openFolder()} title="Abrir carpeta (Ctrl+O)">
        Abrir carpeta
      </button>
      <span className="toolbar-project" title={project?.rootPath}>
        {project?.name ?? 'Sin proyecto'}
      </span>
      <SearchBar />
      <button onClick={collapseAll} disabled={!project}>
        Colapsar todo
      </button>
      <button onClick={() => void refresh()} disabled={!project}>
        Refrescar
      </button>
      <button onClick={togglePanel} disabled={!project} title="Mostrar/ocultar terminal (Ctrl+Ñ)">
        {terminalOpen ? 'Ocultar terminal' : 'Terminal'}
      </button>
    </header>
  )
}
