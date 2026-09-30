import { create } from 'zustand'
import { errorMessage } from '../lib/errors'
import { createInstance, disposeInstance, writeToInstance } from '../terminal/registry'
import { useProjectStore } from './projectStore'

export interface TerminalTab {
  id: number
  title: string
  /** Script del package.json que ejecuta, o null si es una shell interactiva. */
  script: string | null
  command: string | null
  /** null mientras el proceso sigue vivo. */
  exitCode: number | null
}

interface TerminalState {
  tabs: TerminalTab[]
  active: number | null
  panelOpen: boolean

  newShell: () => Promise<void>
  /** Ejecuta un script del package.json; si ya está corriendo, solo lo muestra. */
  runScript: (name: string) => Promise<void>
  stop: (id: number) => Promise<void>
  restart: (id: number) => Promise<void>
  close: (id: number) => Promise<void>
  activate: (id: number) => void
  togglePanel: () => void
  /** Olvida todas las terminales (el main ya las mató al cambiar de proyecto). */
  reset: () => void
}

/** Tamaño inicial; xterm lo ajusta al contenedor en cuanto se monta. */
const INITIAL_SIZE = { cols: 120, rows: 30 }

function packageManager(): string {
  const rootFiles = new Set(useProjectStore.getState().children[''] ?? [])
  if (rootFiles.has('pnpm-lock.yaml')) return 'pnpm'
  if (rootFiles.has('yarn.lock')) return 'yarn'
  if (rootFiles.has('bun.lockb') || rootFiles.has('bun.lock')) return 'bun'
  return 'npm'
}

function scriptCommand(name: string): string {
  const quoted = /^[\w:.@/-]+$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`
  return `${packageManager()} run ${quoted}`
}

export const useTerminalStore = create<TerminalState>()((set, get) => {
  let shellCount = 0

  /** Crea el proceso y su pestaña. Si `replaceId` existe, la nueva ocupa su lugar. */
  async function spawn(title: string, script: string | null, command: string | null, replaceId?: number) {
    let id: number
    try {
      id = await window.api.terminalCreate({ command: command ?? undefined, ...INITIAL_SIZE })
    } catch (err) {
      useProjectStore.getState().setError(`No se pudo abrir la terminal: ${errorMessage(err)}`)
      return
    }
    createInstance(id, command ? `\x1b[90m> ${command}\x1b[0m\r\n\r\n` : undefined)
    const tab: TerminalTab = { id, title, script, command, exitCode: null }
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === replaceId)
      const tabs = index === -1 ? [...s.tabs, tab] : s.tabs.map((t, i) => (i === index ? tab : t))
      return { tabs, active: id, panelOpen: true }
    })
  }

  return {
    tabs: [],
    active: null,
    panelOpen: false,

    async newShell() {
      shellCount++
      await spawn(`Terminal ${shellCount}`, null, null)
    },

    async runScript(name) {
      const existing = get().tabs.find((t) => t.script === name)
      if (existing && existing.exitCode === null) {
        set({ active: existing.id, panelOpen: true })
      } else if (existing) {
        await get().restart(existing.id)
      } else {
        await spawn(name, name, scriptCommand(name))
      }
    },

    async stop(id) {
      await window.api.terminalKill(id)
    },

    async restart(id) {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab?.command) return
      if (tab.exitCode === null) await window.api.terminalKill(id)
      disposeInstance(id)
      // Recalculamos el comando: puede haber cambiado el gestor de paquetes.
      await spawn(tab.title, tab.script, tab.script ? scriptCommand(tab.script) : tab.command, id)
    },

    async close(id) {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return
      if (tab.exitCode === null) await window.api.terminalKill(id)
      disposeInstance(id)
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id)
        const tabs = s.tabs.filter((t) => t.id !== id)
        const active = s.active === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.active
        return { tabs, active, panelOpen: tabs.length > 0 && s.panelOpen }
      })
    },

    activate(id) {
      set({ active: id })
    },

    togglePanel() {
      const opening = !get().panelOpen
      set({ panelOpen: opening })
      // Como en VS Code: abrir el panel sin terminales crea una.
      if (opening && get().tabs.length === 0 && useProjectStore.getState().project) void get().newShell()
    },

    reset() {
      for (const tab of get().tabs) disposeInstance(tab.id)
      shellCount = 0
      set({ tabs: [], active: null })
    }
  }
})

window.api.onTerminalExit((id, exitCode) => {
  if (!useTerminalStore.getState().tabs.some((t) => t.id === id)) return
  writeToInstance(id, `\r\n\x1b[90m[Proceso terminado con código ${exitCode}]\x1b[0m\r\n`)
  useTerminalStore.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, exitCode } : t)) }))
})
