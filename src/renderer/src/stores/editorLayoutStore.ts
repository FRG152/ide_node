import { create } from 'zustand'
import { loadSetting, saveSetting } from '../lib/settings'

/** Tamaño de la ventana central del editor (se recuerda entre sesiones). */

export const MIN_EDITOR_WIDTH = 420
const STORAGE_KEY = 'ide-node:editor-window'

interface EditorLayoutState {
  /** Ancho elegido arrastrando los bordes (null: el de por defecto). */
  width: number | null
  maximized: boolean
  setWidth: (width: number) => void
  toggleMaximized: () => void
}

function load(): Pick<EditorLayoutState, 'width' | 'maximized'> {
  try {
    const saved = JSON.parse(loadSetting(STORAGE_KEY) ?? 'null') as { width?: unknown; maximized?: unknown } | null
    return {
      width: typeof saved?.width === 'number' && saved.width >= MIN_EDITOR_WIDTH ? saved.width : null,
      maximized: saved?.maximized === true
    }
  } catch {
    return { width: null, maximized: false }
  }
}

export const useEditorLayoutStore = create<EditorLayoutState>()((set, get) => {
  const save = (): void => {
    const { width, maximized } = get()
    saveSetting(STORAGE_KEY, JSON.stringify({ width, maximized }))
  }
  return {
    ...load(),
    setWidth(width) {
      set({ width: Math.round(width), maximized: false })
      save()
    },
    toggleMaximized() {
      set((s) => ({ maximized: !s.maximized }))
      save()
    }
  }
})
