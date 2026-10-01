import { create } from 'zustand'
import { closeDocument, isDirty, getDocument, loadDocument, reloadDocument, saveDocument } from '../editor/documents'
import { t } from '../i18n'
import { errorMessage } from '../lib/errors'
import { useProjectStore } from './projectStore'

interface EditorState {
  /** Archivo en la ventana central del editor (null: ninguno a la vista). */
  active: string | null
  /** Archivos minimizados, en el orden en que se minimizaron (lista de la derecha, de arriba abajo). */
  minimized: string[]
  dirty: Record<string, true>
  /** Línea a la que llevar el cursor cuando el archivo esté en el editor. */
  pendingLine: { path: string; line: number } | null

  /**
   * Lleva el archivo a la ventana central (el que estuviera en ella se minimiza) y mueve la
   * cámara del grafo hacia su nodo: 'center' lo centra siempre; 'ifHidden' solo si no se ve.
   */
  open: (path: string, camera?: 'center' | 'ifHidden') => Promise<void>
  /** Lleva el cursor a una línea del archivo (cuando esté en la ventana central). */
  goToLine: (path: string, line: number) => void
  clearPendingLine: () => void
  /** Minimiza el archivo de la ventana central a la lista de la derecha. */
  minimize: () => void
  /** Cierra el archivo; si tiene cambios, pregunta. Devuelve false si el usuario canceló. */
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

/** Todos los archivos abiertos: el central y los minimizados. */
export function openPaths(state: Pick<EditorState, 'active' | 'minimized'>): string[] {
  return state.active ? [state.active, ...state.minimized] : state.minimized
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
    active: null,
    minimized: [],
    dirty: {},
    pendingLine: null,

    async open(path, camera = 'ifHidden') {
      await loadDocument(path, (dirty) => setDirty(path, dirty))
      set((s) => {
        const minimized = s.minimized.filter((p) => p !== path)
        if (s.active && s.active !== path) minimized.push(s.active)
        return { active: path, minimized }
      })
      // El nodo queda detrás de la ventana central; al minimizarla, aparece ahí mismo.
      const project = useProjectStore.getState()
      if (camera === 'center') project.focus(path)
      else project.ensureVisible(path)
    },

    goToLine(path, line) {
      set({ pendingLine: { path, line } })
    },

    clearPendingLine() {
      set({ pendingLine: null })
    },

    minimize() {
      const { active } = get()
      if (!active) return
      set((s) => ({ active: null, minimized: [...s.minimized, active] }))
      useProjectStore.getState().ensureVisible(active)
    },

    async close(path) {
      if (isDirty(getDocument(path))) {
        const choice = await window.api.confirmUnsaved([path])
        if (choice === 'cancel') return false
        if (choice === 'save' && !(await get().save(path))) return false
      }
      closeDocument(path)
      setDirty(path, false)
      set((s) => ({
        active: s.active === path ? null : s.active,
        minimized: s.minimized.filter((p) => p !== path)
      }))
      return true
    },

    async save(path) {
      try {
        await saveDocument(path)
        setDirty(path, isDirty(getDocument(path))) // pudo editarse mientras se guardaba
        return true
      } catch (err) {
        reportError(t('error.save', { path, message: errorMessage(err) }))
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
      for (const path of openPaths(get())) closeDocument(path)
      set({ active: null, minimized: [], dirty: {} })
    },

    async syncFromDisk(paths) {
      const open = new Set(openPaths(get()))
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
