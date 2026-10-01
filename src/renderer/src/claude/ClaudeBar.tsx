import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { IDE_TOOL_PREFIX } from '../../../shared/ipc'
import { isMessageKey, t, useT } from '../i18n'
import { classes } from '../lib/classes'
import { FOCUS_CLAUDE_EVENT, useClaudeStore, type ClaudeEntry } from '../stores/claudeStore'
import { useProjectStore } from '../stores/projectStore'
import { formatElapsed, Spinner, useElapsedSeconds } from './Spinner'

const MAX_INPUT_HEIGHT = 160

/** Nombre legible de una herramienta de Claude Code (o de las de la interfaz, mcp__ide_node__*). */
function toolLabel(name: string): string {
  const short = name.startsWith(IDE_TOOL_PREFIX) ? name.slice(IDE_TOOL_PREFIX.length) : name
  const key = `tool.${short}`
  return isMessageKey(key) ? t(key) : name
}

/** Input flotante abajo en el centro para hablar con Claude, con la conversación encima. */
export function ClaudeBar() {
  const t = useT()
  const {
    entries,
    running,
    runStartedAt,
    transcriptOpen,
    barCollapsed,
    unseenResult,
    send,
    cancel,
    newConversation,
    toggleTranscript,
    collapseBar,
    expandBar
  } = useClaudeStore(
    useShallow((s) => ({
      entries: s.entries,
      running: s.running,
      runStartedAt: s.runStartedAt,
      transcriptOpen: s.transcriptOpen,
      barCollapsed: s.barCollapsed,
      unseenResult: s.unseenResult,
      send: s.send,
      cancel: s.cancel,
      newConversation: s.newConversation,
      toggleTranscript: s.toggleTranscript,
      collapseBar: s.collapseBar,
      expandBar: s.expandBar
    }))
  )
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  // Ctrl+I o clic en la píldora: enfocar el input (tras montarse, si estaba minimizado).
  useEffect(() => {
    const focus = (): void => {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    window.addEventListener(FOCUS_CLAUDE_EVENT, focus)
    return () => window.removeEventListener(FOCUS_CLAUDE_EVENT, focus)
  }, [])

  // El textarea crece con el texto hasta un máximo.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [draft, barCollapsed])

  // Seguir el final de la conversación según llega la respuesta.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, transcriptOpen, barCollapsed])

  if (barCollapsed) {
    return <ClaudePill running={running} startedAt={runStartedAt} unseen={unseenResult} onOpen={expandBar} />
  }

  const submit = (): void => {
    if (!draft.trim() || running) return
    void send(draft)
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      // Como en Claude Code: Esc interrumpe. Sin nada en marcha, minimiza el input.
      e.preventDefault()
      if (running) void cancel()
      else collapseBar()
    }
  }

  const hasConversation = entries.length > 0

  return (
    <div className="claude-bar">
      {hasConversation && transcriptOpen && (
        <div className="claude-transcript" ref={transcriptRef}>
          {entries.map((entry, i) => (
            <Entry key={i} entry={entry} />
          ))}
        </div>
      )}
      {running && <WorkingLine startedAt={runStartedAt} />}
      <div className="claude-input-row">
        {hasConversation && (
          <button
            className="claude-icon"
            onClick={toggleTranscript}
            title={transcriptOpen ? t('claude.hideTranscript') : t('claude.showTranscript')}
          >
            {transcriptOpen ? '▾' : '▴'}
          </button>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder={t('claude.placeholder')}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <button className="claude-stop" onClick={() => void cancel()}>
            {t('claude.stop')}
          </button>
        ) : (
          <button className="primary" onClick={submit} disabled={!draft.trim()}>
            {t('claude.send')}
          </button>
        )}
        {hasConversation && !running && (
          <button className="claude-icon" onClick={newConversation} title={t('claude.newConversation')}>
            ⟲
          </button>
        )}
        <button className="claude-icon" onClick={collapseBar} title={t('claude.minimize')}>
          —
        </button>
      </div>
    </div>
  )
}

/** "✻ Working… 12s · esc to interrupt": visible aunque la conversación esté plegada. */
function WorkingLine({ startedAt }: { startedAt: number | null }) {
  const t = useT()
  const elapsed = useElapsedSeconds(startedAt)
  return (
    <div className="claude-working">
      <Spinner />
      <span className="claude-working-label">{t('claude.working')}</span>
      <span className="claude-working-meta">
        {formatElapsed(elapsed)} · {t('claude.escToInterrupt')}
      </span>
    </div>
  )
}

/** El input minimizado: sigue diciendo si Claude trabaja y avisa cuando termina. */
function ClaudePill(props: { running: boolean; startedAt: number | null; unseen: boolean; onOpen: () => void }) {
  const t = useT()
  const elapsed = useElapsedSeconds(props.running ? props.startedAt : null)
  return (
    <button
      className={classes('claude-pill', props.running && 'running', props.unseen && 'unseen')}
      onClick={props.onOpen}
      title={t('claude.ask')}
    >
      {props.running ? <Spinner /> : <span className="claude-glyph">✻</span>}
      <span>
        {props.running
          ? `${t('claude.working')} ${formatElapsed(elapsed)}`
          : props.unseen
            ? t('claude.finished')
            : t('claude.ask')}
      </span>
    </button>
  )
}

function Entry({ entry }: { entry: ClaudeEntry }) {
  const t = useT()
  switch (entry.kind) {
    case 'user':
      return <div className="claude-entry claude-user">{entry.text}</div>
    case 'assistant':
      return <div className="claude-entry claude-assistant">{entry.text}</div>
    case 'info':
      return <div className={classes('claude-entry', 'claude-info', entry.error && 'error')}>{entry.text}</div>
    case 'tool': {
      const { path } = entry
      const isUiTool = entry.name.startsWith(IDE_TOOL_PREFIX)
      return (
        <div
          className={classes(
            'claude-entry',
            'claude-tool',
            entry.access && `claude-tool-${entry.access}`,
            isUiTool && 'claude-tool-ui',
            path !== null && 'link'
          )}
          title={path !== null ? t('claude.toolLinkTitle') : undefined}
          onClick={path !== null ? () => void useProjectStore.getState().reveal(path) : undefined}
        >
          <span className="claude-tool-name">{toolLabel(entry.name)}</span>
          <span className="claude-tool-detail">{entry.detail || (isUiTool ? t('tool.root') : '')}</span>
        </div>
      )
    }
  }
}
