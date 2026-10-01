import { useShallow } from 'zustand/react/shallow'
import type { UsageWindow } from '../../../shared/ipc'
import { formatTokens, useLanguageStore, useT } from '../i18n'
import { classes } from '../lib/classes'
import { useClaudeStore } from '../stores/claudeStore'
import { Spinner } from './Spinner'

/** A partir de aquí, contexto y límites se pintan en color de aviso. */
const WARN_PERCENT = 80

/** "claude-opus-5-5" -> "Opus 5.5". */
function modelName(model: string | null): string | null {
  if (!model) return null
  const parts = model
    .replace(/^claude-/, '')
    .split('-')
    .filter((p) => !/^\d{8}$/.test(p)) // sin sufijo de fecha
  const [family, ...version] = parts
  if (!family) return model
  return `${family[0].toUpperCase()}${family.slice(1)}${version.length ? ' ' + version.join('.') : ''}`
}

/** Uso de Claude arriba a la izquierda: modelo, contexto, tokens de la conversación y límites del plan. */
export function ClaudeStatus() {
  const t = useT()
  const language = useLanguageStore((s) => s.language)
  const { model, running, contextTokens, contextWindow, usage, limits } = useClaudeStore(
    useShallow((s) => ({
      model: s.model,
      running: s.running,
      contextTokens: s.contextTokens,
      contextWindow: s.contextWindow,
      usage: s.usage,
      limits: s.limits
    }))
  )

  const totalTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens
  const contextPercent =
    contextTokens !== null && contextWindow ? Math.min(100, Math.round((contextTokens / contextWindow) * 100)) : null

  const resetTime = (window: UsageWindow | null): string =>
    window?.resetsAt
      ? new Date(window.resetsAt * 1000).toLocaleString(language, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
      : '—'
  const percentOf = (window: UsageWindow | null): number | null =>
    window ? Math.round(window.utilization * 100) : null

  return (
    <div className="claude-status">
      <span className={classes('claude-status-model', running && 'running')} title={running ? t('usage.workingTitle') : undefined}>
        {running ? <Spinner /> : <span className="claude-glyph">✻</span>}
        {modelName(model) ?? t('usage.claude')}
      </span>

      {contextTokens === null ? (
        <span className="claude-status-dim">{t('usage.noUsage')}</span>
      ) : (
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

      {totalTokens > 0 && (
        <span
          className="claude-status-tokens"
          title={t('usage.tokensTitle', {
            input: usage.inputTokens.toLocaleString(language),
            cacheRead: usage.cacheReadTokens.toLocaleString(language),
            cacheWrite: usage.cacheWriteTokens.toLocaleString(language),
            output: usage.outputTokens.toLocaleString(language),
            cost: `$${usage.costUsd.toFixed(2)}`
          })}
        >
          {t('usage.tokens', { count: formatTokens(totalTokens) })}
        </span>
      )}

      {limits && (limits.fiveHour || limits.sevenDay) && (
        <span
          className="claude-status-limits"
          title={t('usage.limitsTitle', {
            fiveHour: percentOf(limits.fiveHour) === null ? '—' : `${percentOf(limits.fiveHour)}%`,
            fiveHourReset: resetTime(limits.fiveHour),
            sevenDay: percentOf(limits.sevenDay) === null ? '—' : `${percentOf(limits.sevenDay)}%`,
            sevenDayReset: resetTime(limits.sevenDay)
          })}
        >
          {limits.fiveHour && (
            <span className={classes((percentOf(limits.fiveHour) ?? 0) >= WARN_PERCENT && 'warn')}>
              {t('usage.limit5h', { percent: percentOf(limits.fiveHour) ?? 0 })}
            </span>
          )}
          {limits.sevenDay && (
            <span className={classes((percentOf(limits.sevenDay) ?? 0) >= WARN_PERCENT && 'warn')}>
              {t('usage.limit7d', { percent: percentOf(limits.sevenDay) ?? 0 })}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
