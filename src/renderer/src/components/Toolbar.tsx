import { ClaudeStatus } from '../claude/ClaudeStatus'
import { FOCUS_GRAPH_EVENT } from '../graph/keyboard'
import { useT } from '../i18n'
import { useGraphViewStore } from '../stores/graphViewStore'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { SearchBar } from './SearchBar'

export function Toolbar() {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const openFolder = useProjectStore((s) => s.openFolder)
  const collapseAll = useProjectStore((s) => s.collapseAll)
  const expandAll = useProjectStore((s) => s.expandAll)
  const view = useGraphViewStore((s) => s.view)
  const setView = useGraphViewStore((s) => s.setView)
  const refresh = useProjectStore((s) => s.refresh)
  const autoCollapse = useProjectStore((s) => s.autoCollapse)
  const setAutoCollapse = useProjectStore((s) => s.setAutoCollapse)
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
      <div className="segmented" role="group" title={t('toolbar.viewTitle')}>
        <button onClick={() => setView('tree')} disabled={!project} aria-pressed={view === 'tree'}>
          {t('toolbar.viewTree')}
        </button>
        <button onClick={() => setView('network')} disabled={!project} aria-pressed={view === 'network'}>
          {t('toolbar.viewNetwork')}
        </button>
      </div>
      <button
        onClick={() => window.dispatchEvent(new Event(FOCUS_GRAPH_EVENT))}
        disabled={!project}
        title={t('toolbar.keyboard')}
      >
        ⌨
      </button>
      <button
        onClick={() => setAutoCollapse(!autoCollapse)}
        disabled={!project}
        aria-pressed={autoCollapse}
        title={t('toolbar.autoCollapseTitle')}
      >
        {t('toolbar.autoCollapse')}
      </button>
      <button onClick={() => void expandAll()} disabled={!project} title={t('toolbar.expandAllTitle')}>
        {t('toolbar.expandAll')}
      </button>
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
