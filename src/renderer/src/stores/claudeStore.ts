import { create } from 'zustand'
import type { ClaudeEvent, ClaudeFileAccess, ClaudeUsage } from '../../../shared/ipc'
import { useProjectStore } from './projectStore'

/**
 * Lo que la app sabe de la sesión de Claude Code que corre en la terminal (pestaña "Claude").
 * La conversación la lleva el propio Claude Code; esto solo refleja su estado, por sus hooks.
 */
export type ClaudeStatus = 'off' | 'idle' | 'working' | 'attention'

interface ClaudeState {
  status: ClaudeStatus
  /** Desde cuándo trabaja (para mostrar el tiempo transcurrido). */
  workingSince: number | null
  /** Por qué espera al usuario (p. ej. "Claude needs your permission to use Bash"). */
  attentionMessage: string | null
  /** Última herramienta que usó: se muestra arriba aunque la terminal esté oculta. */
  lastTool: { name: string; detail: string } | null
  /** Archivos que ha leído o editado en esta sesión (se resaltan en el grafo). */
  touched: Record<string, ClaudeFileAccess>
  model: string | null
  contextTokens: number | null
  contextWindow: number | null
  usage: ClaudeUsage | null

  setStatus: (status: ClaudeStatus) => void
  reset: () => void
}

const initialSession = {
  status: 'off' as ClaudeStatus,
  workingSince: null,
  attentionMessage: null,
  lastTool: null,
  touched: {},
  model: null,
  contextTokens: null,
  contextWindow: null,
  usage: null
}

export const useClaudeStore = create<ClaudeState>()((set) => ({
  ...initialSession,
  setStatus(status) {
    set((s) => ({
      status,
      // Esperar un permiso no reinicia el contador: sigue siendo el mismo turno.
      workingSince: status === 'working' || status === 'attention' ? (s.workingSince ?? Date.now()) : null,
      attentionMessage: status === 'attention' ? s.attentionMessage : null,
      lastTool: status === 'working' || status === 'attention' ? s.lastTool : null
    }))
  },
  reset() {
    set(initialSession)
  }
}))

function handleEvent(event: ClaudeEvent): void {
  const store = useClaudeStore
  switch (event.type) {
    case 'working':
      store.getState().setStatus('working')
      break

    case 'idle':
      store.getState().setStatus('idle')
      break

    case 'attention':
      // También avisa cuando lleva un rato esperando un mensaje nuevo: eso no es "te necesita".
      if (store.getState().status === 'working') {
        store.setState({ attentionMessage: event.message })
        store.getState().setStatus('attention')
      }
      break

    case 'tool': {
      const { path, access } = event
      store.setState({ lastTool: { name: event.name, detail: event.detail } })
      if (path && access) {
        store.setState((s) => ({ touched: { ...s.touched, [path]: s.touched[path] === 'edit' ? 'edit' : access } }))
        // Que se vea en el grafo lo que está modificando.
        if (access === 'edit') void useProjectStore.getState().expandTo(path)
      }
      break
    }

    case 'usage':
      store.setState({
        model: event.model,
        contextTokens: event.contextTokens,
        contextWindow: event.contextWindow,
        usage: event.usage
      })
      break
  }
}

window.api.onClaudeEvent((event) => {
  // Hooks de otra sesión de Claude (p. ej. una pestaña que ya cerramos): sin pestaña, se ignoran.
  if (useClaudeStore.getState().status !== 'off') handleEvent(event)
})
