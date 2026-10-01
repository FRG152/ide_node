import { create } from 'zustand'
import type { ClaudeEvent, ClaudeFileAccess } from '../../../shared/ipc'
import { errorMessage } from '../lib/errors'
import { useProjectStore } from './projectStore'

export type ClaudeEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; detail: string; path: string | null; access: ClaudeFileAccess | null }
  | { kind: 'info'; text: string; error: boolean }

interface ClaudeState {
  entries: ClaudeEntry[]
  running: boolean
  /** Ejecución en curso; los eventos de otras (canceladas) se ignoran. */
  runId: number | null
  /** Conversación de Claude Code: se reanuda en cada mensaje para que recuerde el contexto. */
  sessionId: string | null
  /** Archivos que Claude ha leído o editado en esta conversación (se resaltan en el grafo). */
  touched: Record<string, ClaudeFileAccess>
  transcriptOpen: boolean

  send: (prompt: string) => Promise<void>
  cancel: () => Promise<void>
  newConversation: () => void
  toggleTranscript: () => void
}

let nextRunId = 1

const initialConversation = {
  entries: [],
  running: false,
  runId: null,
  sessionId: null,
  touched: {}
}

export const useClaudeStore = create<ClaudeState>()((set, get) => ({
  ...initialConversation,
  transcriptOpen: true,

  async send(prompt) {
    const text = prompt.trim()
    if (!text || get().running) return
    const runId = nextRunId++
    set((s) => ({ entries: [...s.entries, { kind: 'user', text }], running: true, runId, transcriptOpen: true }))
    try {
      await window.api.claudeRun(runId, text, get().sessionId)
    } catch (err) {
      set((s) => ({ running: false, entries: [...s.entries, { kind: 'info', text: errorMessage(err), error: true }] }))
    }
  },

  async cancel() {
    if (get().running) await window.api.claudeCancel()
  },

  newConversation() {
    if (get().running) void window.api.claudeCancel()
    set(initialConversation)
  },

  toggleTranscript() {
    set((s) => ({ transcriptOpen: !s.transcriptOpen }))
  }
}))

function append(entry: ClaudeEntry): void {
  useClaudeStore.setState((s) => ({ entries: [...s.entries, entry] }))
}

function handleEvent(event: ClaudeEvent): void {
  const store = useClaudeStore
  switch (event.type) {
    case 'session':
      store.setState({ sessionId: event.sessionId })
      break

    case 'text':
      store.setState((s) => {
        const last = s.entries[s.entries.length - 1]
        if (last?.kind === 'assistant') {
          return { entries: [...s.entries.slice(0, -1), { kind: 'assistant', text: last.text + event.text }] }
        }
        return { entries: [...s.entries, { kind: 'assistant', text: event.text }] }
      })
      break

    case 'tool': {
      const { path, access } = event
      append({ kind: 'tool', name: event.name, detail: event.detail, path, access })
      if (path && access) {
        store.setState((s) => ({
          touched: { ...s.touched, [path]: s.touched[path] === 'edit' ? 'edit' : access }
        }))
        // Que se vea en el grafo lo que está modificando.
        if (access === 'edit') void useProjectStore.getState().expandTo(path)
      }
      break
    }

    case 'done': {
      const lastUser = store.getState().entries.map((e) => e.kind).lastIndexOf('user')
      const answered = store.getState().entries.slice(lastUser).some((e) => e.kind === 'assistant')
      // Sin streaming (o si se perdió), mostramos el texto final.
      if (!answered && event.result) append({ kind: 'assistant', text: event.result })
      if (!event.ok) append({ kind: 'info', text: 'Claude no pudo completar la tarea.', error: true })
      if (event.denied.length > 0) {
        append({
          kind: 'info',
          text: `No permitido (Claude solo puede leer y editar archivos): ${event.denied.join(' · ')}`,
          error: false
        })
      }
      store.setState({ running: false, runId: null })
      break
    }

    case 'error':
      append({ kind: 'info', text: event.message, error: true })
      store.setState({ running: false, runId: null })
      break
  }
}

window.api.onClaudeEvent((runId, event) => {
  if (runId === useClaudeStore.getState().runId) handleEvent(event)
})
