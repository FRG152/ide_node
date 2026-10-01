import { ClaudeStatus } from '../claude/ClaudeStatus'
import { useT } from '../i18n'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { SearchBar } from './SearchBar'

export function Toolbar() {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const openFolder = useProjectStore((s) => s.openFolder)
  const collapseAll = useProjectStore((s) => s.collapseAll)
  const refresh = useProjectStore((s) => s.refresh)
  const terminalOpen = useTerminalStore((s) => s.panelOpen)
  const togglePanel = useTerminalStore((s) => s.togglePanel)

  return (
    <header className="toolbar">
      {/* Arriba a la izquierda, lo primero: el estado de Claude (modelo, contexto, tokens, límites). */}
      <ClaudeStatus />
      <span className="toolbar-divider" />
      <button onClick={() => void openFolder()} title={t('toolbar.openFolderTitle')}>
        {t('toolbar.openFolder')}
      </button>
      <span className="toolbar-project" title={project?.rootPath}>
        {project?.name ?? t('toolbar.noProject')}
      </span>
      <SearchBar />
      <button onClick={collapseAll} disabled={!project}>
        {t('toolbar.collapseAll')}
      </button>
      <button onClick={() => void refresh()} disabled={!project}>
        {t('toolbar.refresh')}
      </button>
      <button onClick={togglePanel} disabled={!project} title={t('toolbar.terminalTitle')}>
        {terminalOpen ? t('toolbar.hideTerminal') : t('toolbar.terminal')}
      </button>
    </header>
  )
}
