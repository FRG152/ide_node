import { create } from 'zustand'
import { closeDocument, isDirty, getDocument, loadDocument, reloadDocument, saveDocument } from '../editor/documents'
import { errorMessage } from '../lib/errors'
import { useProjectStore } from './projectStore'

interface EditorState {
  /** Archivos abiertos, en orden de pestañas. */
  tabs: string[]
  active: string | null
  dirty: Record<string, true>

  /**
   * Abre el archivo en una pestaña y mueve la cámara del grafo hacia su nodo:
   * 'center' lo centra siempre; 'ifHidden' solo si quedó fuera de la vista.
   */
  open: (path: string, camera?: 'center' | 'ifHidden') => Promise<void>
  activate: (path: string) => void
  /** Cierra la pestaña; si tiene cambios, pregunta. Devuelve false si el usuario canceló. */
  close: (path: string) => Promise<boolean>
  save: (path: string) => Promise<boolean>
  saveAll: () => Promise<boolean>
  /** Pregunta qué hacer con los cambios pendientes antes de descartar todos los documentos. */
  confirmCloseAll: () => Promise<boolean>
  /** Cierra todo sin preguntar. */
  closeAll: () => void
  syncFromDisk: (paths: string[]) => Promise<void>
}

function reportError(message: string): void {
  useProjectStore.getState().setError(message)
}

export const useEditorStore = create<EditorState>()((set, get) => {
  function setDirty(path: string, dirty: boolean): void {
    if (Boolean(get().dirty[path]) === dirty) return
    set((s) => {
      const next = { ...s.dirty }
      if (dirty) next[path] = true
      else delete next[path]
      return { dirty: next }
    })
  }

  return {
    tabs: [],
    active: null,
    dirty: {},

    async open(path, camera = 'ifHidden') {
      await loadDocument(path, (dirty) => setDirty(path, dirty))
      set((s) => ({ tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path], active: path }))
      // Después de abrir la pestaña: si es la primera, el grafo se acaba de estrechar
      // y la cámara ya se calcula con el tamaño final del lienzo.
      const project = useProjectStore.getState()
      if (camera === 'center') project.focus(path)
      else project.ensureVisible(path)
    },

    activate(path) {
      set({ active: path })
      useProjectStore.getState().ensureVisible(path)
    },

    async close(path) {
      if (isDirty(getDocument(path))) {
        const choice = await window.api.confirmUnsaved([path])
        if (choice === 'cancel') return false
        if (choice === 'save' && !(await get().save(path))) return false
      }
      closeDocument(path)
      setDirty(path, false)
      set((s) => {
        const index = s.tabs.indexOf(path)
        const tabs = s.tabs.filter((p) => p !== path)
        // Como en VS Code: se activa la pestaña vecina.
        const active = s.active === path ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.active
        return { tabs, active }
      })
      return true
    },

    async save(path) {
      try {
        await saveDocument(path)
        setDirty(path, isDirty(getDocument(path))) // pudo editarse mientras se guardaba
        return true
      } catch (err) {
        reportError(`No se pudo guardar "${path}": ${errorMessage(err)}`)
        return false
      }
    },

    async saveAll() {
      const results = await Promise.all(Object.keys(get().dirty).map((path) => get().save(path)))
      return results.every(Boolean)
    },

    async confirmCloseAll() {
      const dirtyPaths = Object.keys(get().dirty)
      if (dirtyPaths.length === 0) return true
      const choice = await window.api.confirmUnsaved(dirtyPaths)
      if (choice === 'cancel') return false
      if (choice === 'save') return get().saveAll()
      return true
    },

    closeAll() {
      for (const path of get().tabs) closeDocument(path)
      set({ tabs: [], active: null, dirty: {} })
    },

    async syncFromDisk(paths) {
      const open = new Set(get().tabs)
      await Promise.all(
        paths
          .filter((p) => open.has(p))
          .map(async (p) => {
            // La edición de recarga marca el documento como sucio antes de actualizar
            // su versión guardada: recalculamos al terminar.
            if (await reloadDocument(p)) setDirty(p, isDirty(getDocument(p)))
          })
      )
    }
  }
})
