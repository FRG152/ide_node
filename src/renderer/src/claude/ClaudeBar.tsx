import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { IDE_TOOL_PREFIX } from '../../../shared/ipc'
import { classes } from '../lib/classes'
import { useClaudeStore, type ClaudeEntry } from '../stores/claudeStore'
import { useProjectStore } from '../stores/projectStore'

const MAX_INPUT_HEIGHT = 160

/** Nombre legible de cada herramienta de Claude Code. */
const TOOL_LABELS: Record<string, string> = {
  Read: 'Lee',
  Edit: 'Edita',
  Write: 'Escribe',
  NotebookEdit: 'Edita',
  Grep: 'Busca',
  Glob: 'Busca archivos',
  Bash: 'Ejecuta',
  PowerShell: 'Ejecuta',
  WebFetch: 'Consulta',
  WebSearch: 'Busca en la web',
  Task: 'Subagente',
  Agent: 'Subagente',
  TodoWrite: 'Planifica',
  // Herramientas de la interfaz (servidor MCP de la app)
  [`${IDE_TOOL_PREFIX}expand_folder`]: 'Abre carpeta',
  [`${IDE_TOOL_PREFIX}collapse_folder`]: 'Cierra carpeta',
  [`${IDE_TOOL_PREFIX}select_node`]: 'Selecciona',
  [`${IDE_TOOL_PREFIX}open_file`]: 'Abre',
  [`${IDE_TOOL_PREFIX}get_view`]: 'Mira tu vista'
}

/** Input flotante abajo en el centro para hablar con Claude, con la conversación encima. */
export function ClaudeBar() {
  const { entries, running, transcriptOpen, send, cancel, newConversation, toggleTranscript } = useClaudeStore(
    useShallow((s) => ({
      entries: s.entries,
      running: s.running,
      transcriptOpen: s.transcriptOpen,
      send: s.send,
      cancel: s.cancel,
      newConversation: s.newConversation,
      toggleTranscript: s.toggleTranscript
    }))
  )
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  // El textarea crece con el texto hasta un máximo.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [draft])

  // Seguir el final de la conversación según llega la respuesta.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, transcriptOpen])

  const submit = (): void => {
    if (!draft.trim() || running) return
    void send(draft)
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
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
          {running && <div className="claude-working">Claude está trabajando…</div>}
        </div>
      )}
      <div className="claude-input-row">
        {hasConversation && (
          <button
            className="claude-icon"
            onClick={toggleTranscript}
            title={transcriptOpen ? 'Ocultar conversación' : 'Mostrar conversación'}
          >
            {transcriptOpen ? '▾' : '▴'}
          </button>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder="Pídele algo a Claude…   (Enter envía · Shift+Enter, nueva línea)"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <button className="claude-stop" onClick={() => void cancel()}>
            ■ Detener
          </button>
        ) : (
          <button onClick={submit} disabled={!draft.trim()}>
            Enviar
          </button>
        )}
        {hasConversation && !running && (
          <button className="claude-icon" onClick={newConversation} title="Nueva conversación">
            ⟲
          </button>
        )}
      </div>
    </div>
  )
}

function Entry({ entry }: { entry: ClaudeEntry }) {
  switch (entry.kind) {
    case 'user':
      return <div className="claude-entry claude-user">{entry.text}</div>
    case 'assistant':
      return <div className="claude-entry claude-assistant">{entry.text}</div>
    case 'info':
      return <div className={classes('claude-entry', 'claude-info', entry.error && 'error')}>{entry.text}</div>
    case 'tool': {
      const { path } = entry
      return (
        <div
          className={classes('claude-entry', 'claude-tool', entry.access && `claude-tool-${entry.access}`, !!path && 'link')}
          title={path ? 'Abrir y mostrar en el grafo' : undefined}
          onClick={path ? () => void useProjectStore.getState().reveal(path) : undefined}
        >
          <span className="claude-tool-name">{TOOL_LABELS[entry.name] ?? entry.name}</span>
          <span className="claude-tool-detail">{entry.detail}</span>
        </div>
      )
    }
  }
}
