import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Spinner } from '../claude/Spinner'
import { useClaudeStore } from '../stores/claudeStore'
import { useProjectStore } from '../stores/projectStore'
import { attachWheelZoom } from '../stores/zoomStore'
import { useTerminalStore, type TerminalTab } from '../stores/terminalStore'
import { attachInstance, fitInstance } from './registry'
import { useT } from '../i18n'
import { classes } from '../lib/classes'

function statusOf(tab: TerminalTab): string {
  if (tab.exitCode === null) return 'running'
  return tab.exitCode === 0 ? 'ok' : 'failed'
}

export function TerminalPanel() {
  const t = useT()
  const { tabs, active, newShell, runScript, stop, restart, close, activate, togglePanel } = useTerminalStore(
    useShallow((s) => ({
      tabs: s.tabs,
      active: s.active,
      newShell: s.newShell,
      runScript: s.runScript,
      stop: s.stop,
      restart: s.restart,
      close: s.close,
      activate: s.activate,
      togglePanel: s.togglePanel
    }))
  )
  const scripts = useProjectStore((s) => s.scripts)
  const activeTab = tabs.find((t) => t.id === active)

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <div className="terminal-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={classes('terminal-tab', tab.id === active && 'active', tab.claude && 'claude')}
              onClick={() => activate(tab.id)}
              title={tab.command ?? t('terminal.interactive')}
            >
              {tab.claude ? <ClaudeTabIcon exited={tab.exitCode !== null} /> : null}
              {tab.command && <span className={classes('status-dot', statusOf(tab))} />}
              <span>{tab.title}</span>
              <button
                className="terminal-tab-close"
                title={tab.exitCode === null ? t('terminal.closeKill') : t('terminal.close')}
                onClick={(e) => {
                  e.stopPropagation()
                  void close(tab.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button className="terminal-add" title={t('terminal.new')} onClick={() => void newShell()}>
            +
          </button>
        </div>

        <div className="terminal-scripts">
          {Object.entries(scripts).map(([name, command]) => (
            <button key={name} title={command} onClick={() => void runScript(name)}>
              ▶ {name}
            </button>
          ))}
        </div>

        {activeTab?.command &&
          (activeTab.exitCode === null ? (
            <button onClick={() => void stop(activeTab.id)}>{t('terminal.stop')}</button>
          ) : (
            <button onClick={() => void restart(activeTab.id)}>{t('terminal.restart')}</button>
          ))}
        <button className="terminal-hide" title={t('terminal.hide')} onClick={togglePanel}>
          ▾
        </button>
      </div>

      <div className="terminal-body">
        {activeTab ? (
          <TerminalView key={activeTab.id} id={activeTab.id} />
        ) : (
          <div className="terminal-empty">{t('terminal.empty')}</div>
        )}
      </div>
    </div>
  )
}

function TerminalView({ id }: { id: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = ref.current!
    const detach = attachInstance(id, container)
    const detachWheelZoom = attachWheelZoom(container, 'terminal')
    const observer = new ResizeObserver(() => fitInstance(id))
    observer.observe(container)
    return () => {
      observer.disconnect()
      detachWheelZoom()
      detach()
    }
  }, [id])
  return <div ref={ref} className="terminal-view" />
}

/** Icono de la pestaña de Claude: animado mientras trabaja, en aviso si espera al usuario. */
function ClaudeTabIcon({ exited }: { exited: boolean }) {
  const status = useClaudeStore((s) => s.status)
  if (!exited && status === 'working') return <Spinner />
  return <span className={classes('claude-glyph', !exited && status === 'attention' && 'attention', exited && 'off')}>✻</span>
}
