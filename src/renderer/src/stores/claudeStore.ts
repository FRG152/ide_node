import { create } from 'zustand'
import type { ClaudeEvent, ClaudeFileAccess, ClaudeUsage, UsageWindow } from '../../../shared/ipc'
import { t } from '../i18n'
import { errorMessage } from '../lib/errors'
import { useProjectStore } from './projectStore'

export type ClaudeEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; detail: string; path: string | null; access: ClaudeFileAccess | null }
  | { kind: 'info'; text: string; error: boolean }

export interface PlanLimits {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
}

interface ClaudeState {
  entries: ClaudeEntry[]
  running: boolean
  /** Ejecución en curso; los eventos de otras (canceladas) se ignoran. */
  runId: number | null
  runStartedAt: number | null
  /** Conversación de Claude Code: se reanuda en cada mensaje para que recuerde el contexto. */
  sessionId: string | null
  /** Archivos que Claude ha leído o editado en esta conversación (se resaltan en el grafo). */
  touched: Record<string, ClaudeFileAccess>

  /** Modelo que usa Claude Code (lo anuncia al empezar cada ejecución). */
  model: string | null
  /** Tokens que ocupa ahora el contexto de la conversación. */
  contextTokens: number | null
  contextWindow: number | null
  /** Tokens acumulados en la conversación. */
  usage: ClaudeUsage
  /** Límites del plan (5 horas y semanal): son de la cuenta, sobreviven a "nueva conversación". */
  limits: PlanLimits | null

  transcriptOpen: boolean
  /** Input minimizado a una píldora (que sigue indicando si Claude trabaja). */
  barCollapsed: boolean
  /** Claude terminó mientras el input estaba minimizado: la píldora lo avisa. */
  unseenResult: boolean

  send: (prompt: string) => Promise<void>
  cancel: () => Promise<void>
  newConversation: () => void
  toggleTranscript: () => void
  collapseBar: () => void
  expandBar: () => void
}

const EMPTY_USAGE: ClaudeUsage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: 0 }

let nextRunId = 1

const initialConversation = {
  entries: [],
  running: false,
  runId: null,
  runStartedAt: null,
  sessionId: null,
  touched: {},
  contextTokens: null,
  usage: EMPTY_USAGE,
  unseenResult: false
}

/** Evento que escucha el input para enfocarse (Ctrl+I o clic en la píldora). */
export const FOCUS_CLAUDE_EVENT = 'ide:focus-claude'

export const useClaudeStore = create<ClaudeState>()((set, get) => ({
  ...initialConversation,
  model: null,
  contextWindow: null,
  limits: null,
  transcriptOpen: true,
  barCollapsed: false,

  async send(prompt) {
    const text = prompt.trim()
    if (!text || get().running) return
    const runId = nextRunId++
    set((s) => ({
      entries: [...s.entries, { kind: 'user', text }],
      running: true,
      runId,
      runStartedAt: Date.now(),
      transcriptOpen: true
    }))
    try {
      await window.api.claudeRun(runId, text, get().sessionId)
    } catch (err) {
      set((s) => ({
        running: false,
        runStartedAt: null,
        entries: [...s.entries, { kind: 'info', text: errorMessage(err), error: true }]
      }))
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
  },

  collapseBar() {
    set({ barCollapsed: true })
  },

  expandBar() {
    set({ barCollapsed: false, unseenResult: false, transcriptOpen: true })
    window.dispatchEvent(new Event(FOCUS_CLAUDE_EVENT))
  }
}))

function append(entry: ClaudeEntry): void {
  useClaudeStore.setState((s) => ({ entries: [...s.entries, entry] }))
}

function finishRun(): void {
  useClaudeStore.setState((s) => ({ running: false, runId: null, runStartedAt: null, unseenResult: s.barCollapsed }))
}

function handleEvent(event: ClaudeEvent): void {
  const store = useClaudeStore
  switch (event.type) {
    case 'session':
      store.setState((s) => ({ sessionId: event.sessionId, model: event.model ?? s.model }))
      break

    case 'context':
      store.setState({ contextTokens: event.tokens })
      break

    case 'usage':
      store.setState((s) => ({
        usage: {
          inputTokens: s.usage.inputTokens + event.usage.inputTokens,
          cacheReadTokens: s.usage.cacheReadTokens + event.usage.cacheReadTokens,
          cacheWriteTokens: s.usage.cacheWriteTokens + event.usage.cacheWriteTokens,
          outputTokens: s.usage.outputTokens + event.usage.outputTokens,
          costUsd: s.usage.costUsd + event.usage.costUsd
        },
        contextWindow: event.contextWindow ?? s.contextWindow
      }))
      break

    case 'limits':
      store.setState({ limits: { fiveHour: event.fiveHour, sevenDay: event.sevenDay } })
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
      if (!event.ok) append({ kind: 'info', text: t('claude.failed'), error: true })
      if (event.denied.length > 0) {
        append({ kind: 'info', text: t('claude.denied', { list: event.denied.join(' · ') }), error: false })
      }
      finishRun()
      break
    }

    case 'error':
      append({ kind: 'info', text: event.message, error: true })
      finishRun()
      break
  }
}

window.api.onClaudeEvent((runId, event) => {
  if (runId === useClaudeStore.getState().runId) handleEvent(event)
})
