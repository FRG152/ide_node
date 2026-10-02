import { useShallow } from 'zustand/react/shallow'
import { IDE_TOOL_PREFIX } from '../../../shared/ipc'
import { formatTokens, isMessageKey, t, useLanguageStore, useT } from '../i18n'
import { classes } from '../lib/classes'
import { useClaudeStore } from '../stores/claudeStore'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { formatElapsed, Spinner, useElapsedSeconds } from './Spinner'

/** A partir de aquí, el contexto se pinta en color de aviso. */
const WARN_PERCENT = 80

/** "claude-opus-5-5" -> "Opus 5.5". */
function modelName(model: string | null): string | null {
  if (!model) return null
  const [family, ...version] = model
    .replace(/^claude-/, '')
    .split('-')
    .filter((p) => !/^\d{8}$/.test(p)) // sin sufijo de fecha
  if (!family) return model
  return `${family[0].toUpperCase()}${family.slice(1)}${version.length ? ' ' + version.join('.') : ''}`
}

/** Nombre legible de una herramienta de Claude Code (o de las de la interfaz, mcp__ide_node__*). */
export function toolLabel(name: string): string {
  const short = name.startsWith(IDE_TOOL_PREFIX) ? name.slice(IDE_TOOL_PREFIX.length) : name
  const key = `tool.${short}`
  return isMessageKey(key) ? t(key) : name
}

/**
 * Arriba a la izquierda: el estado de Claude Code (que corre en la terminal) visible siempre,
 * aunque el panel esté oculto. Clic: abre su pestaña.
 */
export function ClaudeStatus() {
  const t = useT()
  const language = useLanguageStore((s) => s.language)
  const hasProject = useProjectStore((s) => s.project !== null)
  const openClaude = useTerminalStore((s) => s.openClaude)
  const { status, workingSince, attentionMessage, lastTool, model, contextTokens, contextWindow, usage } =
    useClaudeStore(
      useShallow((s) => ({
        status: s.status,
        workingSince: s.workingSince,
        attentionMessage: s.attentionMessage,
        lastTool: s.lastTool,
        model: s.model,
        contextTokens: s.contextTokens,
        contextWindow: s.contextWindow,
        usage: s.usage
      }))
    )
  const elapsed = useElapsedSeconds(status === 'working' ? workingSince : null)

  const contextPercent =
    contextTokens !== null && contextWindow ? Math.min(100, Math.round((contextTokens / contextWindow) * 100)) : null
  const totalTokens = usage ? usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens : 0

  return (
    <button
      className={classes('claude-status', status)}
      onClick={() => void openClaude()}
      disabled={!hasProject}
      title={`${t(`claude.status.${status}`)}${attentionMessage ? `\n${attentionMessage}` : ''}\n${t('claude.open')}`}
    >
      <span className="claude-status-model">
        {status === 'working' ? <Spinner /> : <span className="claude-glyph">✻</span>}
        {modelName(model) ?? t('usage.claude')}
      </span>

      {status === 'working' && (
        <span className="claude-status-activity">
          {formatElapsed(elapsed)}
          {lastTool && (
            <span className="claude-status-tool">
              {' · '}
              {toolLabel(lastTool.name)} {lastTool.detail || (lastTool.name.startsWith(IDE_TOOL_PREFIX) ? t('tool.root') : '')}
            </span>
          )}
        </span>
      )}
      {status === 'attention' && <span className="claude-status-attention">{t('claude.label.attention')}</span>}
      {status === 'off' && <span className="claude-status-dim">{t('claude.label.off')}</span>}

      {contextTokens !== null && (
        <span
          className="claude-status-context"
          title={
            contextWindow
              ? t('usage.contextTitle', {
                  used: contextTokens.toLocaleString(language),
                  window: contextWindow.toLocaleString(language),
                  percent: contextPercent ?? 0
                })
              : t('usage.contextUnknown', { used: contextTokens.toLocaleString(language) })
          }
        >
          <span className="context-bar">
            <span
              className={classes('context-fill', (contextPercent ?? 0) >= WARN_PERCENT && 'warn')}
              style={{ width: `${Math.max(contextPercent ?? 0, 2)}%` }}
            />
          </span>
          {formatTokens(contextTokens)}
          {contextWindow ? <span className="claude-status-dim"> / {formatTokens(contextWindow)}</span> : null}
        </span>
      )}

      {usage && totalTokens > 0 && (
        <span
          className="claude-status-tokens"
          title={t('usage.tokensTitle', {
            input: usage.inputTokens.toLocaleString(language),
            cacheRead: usage.cacheReadTokens.toLocaleString(language),
            cacheWrite: usage.cacheWriteTokens.toLocaleString(language),
            output: usage.outputTokens.toLocaleString(language)
          })}
        >
          {t('usage.tokens', { count: formatTokens(totalTokens) })}
        </span>
      )}
    </button>
  )
}
