import { create } from 'zustand'
import { loadSetting, saveSetting } from '../lib/settings'

/**
 * Cómo se dibuja el proyecto: 'tree' es el árbol ordenado (React Flow); 'network', la red de
 * nodos sueltos al estilo del grafo de Obsidian. Se recuerda entre sesiones.
 */
export type GraphView = 'tree' | 'network'

const STORAGE_KEY = 'ide-node:graph-view'

interface GraphViewState {
  view: GraphView
  setView: (view: GraphView) => void
}

export const useGraphViewStore = create<GraphViewState>()((set) => ({
  view: loadSetting(STORAGE_KEY) === 'network' ? 'network' : 'tree',
  setView(view) {
    saveSetting(STORAGE_KEY, view)
    set({ view })
  }
}))
