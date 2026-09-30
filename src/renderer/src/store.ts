import { create } from 'zustand'
import type { FsEntry, IndexEntry, ProjectInfo } from '../../shared/ipc'
import { errorMessage } from './lib/errors'
import { ancestorsOf, depthOf, parentOf } from './lib/paths'

/** Máximo de hijos que se dibujan por carpeta antes de mostrar un nodo "+N más". */
export const MAX_VISIBLE_CHILDREN = 100

type Flags = Record<string, true>

/**
 * Petición de movimiento de cámara para el grafo:
 * - fit: encuadrar todo el árbol.
 * - focus: centrar un nodo (animado).
 * - keep: tras un cambio de layout, dejar ese nodo en el mismo punto de la pantalla.
 */
export type ViewRequest = { id: number } & (
  | { kind: 'fit' }
  | { kind: 'focus'; path: string }
  | { kind: 'keep'; path: string }
)

interface ProjectState {
  project: ProjectInfo | null
  /** Todas las entradas cargadas, por ruta relativa. */
  entries: Record<string, FsEntry>
  /** Hijos (rutas) de cada carpeta ya listada. */
  children: Record<string, string[]>
  expanded: Flags
  /** Carpetas donde el usuario pidió ver todos los hijos, sin el límite. */
  showAll: Flags
  /** Nodo resaltado (archivo o carpeta). */
  selected: string | null
  /** Archivo abierto en el panel de vista previa. */
  openFile: string | null
  index: IndexEntry[]
  indexing: boolean
  indexTruncated: boolean
  /** Petición pendiente para mover la cámara del grafo. */
  viewRequest: ViewRequest | null
  error: string | null

  openFolder: () => Promise<void>
  openInitialProject: () => Promise<void>
  toggleFolder: (path: string) => Promise<void>
  reveal: (path: string) => Promise<void>
  selectFile: (path: string) => void
  closeFile: () => void
  showAllChildren: (path: string) => void
  collapseAll: () => void
  refresh: () => Promise<void>
  setError: (message: string | null) => void
}

let nextRequestId = 1
const fitRequest = (): ViewRequest => ({ id: nextRequestId++, kind: 'fit' })
const focusRequest = (path: string): ViewRequest => ({ id: nextRequestId++, kind: 'focus', path })
const keepRequest = (path: string): ViewRequest => ({ id: nextRequestId++, kind: 'keep', path })

function without(flags: Flags, key: string): Flags {
  const copy = { ...flags }
  delete copy[key]
  return copy
}

function addListing(
  entries: Record<string, FsEntry>,
  children: Record<string, string[]>,
  dir: string,
  list: FsEntry[]
): void {
  for (const entry of list) entries[entry.path] = entry
  children[dir] = list.map((e) => e.path)
}

const emptyProjectState = {
  entries: {},
  children: {},
  expanded: {},
  showAll: {},
  selected: null,
  openFile: null,
  index: [],
  indexing: false,
  indexTruncated: false,
  viewRequest: null,
  error: null
}

export const useProjectStore = create<ProjectState>()((set, get) => {
  /** Lista una carpeta si aún no está cargada. Devuelve false si falló o cambió el proyecto. */
  async function loadChildren(dir: string): Promise<boolean> {
    const project = get().project
    if (!project) return false
    if (get().children[dir]) return true

    let list: FsEntry[]
    try {
      list = await window.api.listDir(dir)
    } catch (err) {
      if (get().project === project) set({ error: `No se pudo leer "${dir || project.name}": ${errorMessage(err)}` })
      return false
    }
    if (get().project !== project) return false

    set((s) => {
      const entries = { ...s.entries }
      const children = { ...s.children }
      addListing(entries, children, dir, list)
      return { entries, children }
    })
    return true
  }

  async function rebuildIndex(): Promise<void> {
    const project = get().project
    if (!project) return
    set({ indexing: true })
    try {
      const result = await window.api.buildIndex()
      if (get().project?.rootPath !== result.rootPath) return
      set({ index: result.entries, indexTruncated: result.truncated, indexing: false })
    } catch (err) {
      if (get().project === project) set({ indexing: false, error: `Error indexando: ${errorMessage(err)}` })
    }
  }

  async function loadProject(info: ProjectInfo): Promise<void> {
    set({
      ...emptyProjectState,
      project: info,
      entries: { '': { path: '', name: info.name, kind: 'directory' } },
      expanded: { '': true }
    })
    await loadChildren('')
    if (get().project === info) set({ viewRequest: fitRequest() })
    void rebuildIndex()
  }

  return {
    project: null,
    ...emptyProjectState,

    async openFolder() {
      try {
        const info = await window.api.openFolder()
        if (info) await loadProject(info)
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    async openInitialProject() {
      try {
        const info = await window.api.initialProject()
        if (info) await loadProject(info)
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    async toggleFolder(path) {
      set({ selected: path })
      if (get().expanded[path]) {
        // Mantenemos el estado de las subcarpetas para restaurarlo al reabrir.
        set((s) => ({ expanded: without(s.expanded, path), viewRequest: keepRequest(path) }))
        return
      }
      if (await loadChildren(path)) {
        set((s) => ({ expanded: { ...s.expanded, [path]: true }, viewRequest: keepRequest(path) }))
      }
    },

    async reveal(path) {
      const ancestors = ancestorsOf(path)
      for (const dir of ancestors) {
        if (!(await loadChildren(dir))) return
      }

      const entry = get().entries[path]
      if (!entry) {
        set({ error: `"${path}" ya no existe. Pulsa "Refrescar" para actualizar el proyecto.` })
        return
      }

      set((s) => {
        const expanded = { ...s.expanded }
        for (const dir of ancestors) expanded[dir] = true

        // Si el nodo quedaría oculto tras el "+N más", mostramos todos los hijos de su carpeta.
        const showAll = { ...s.showAll }
        const parent = parentOf(path)
        if (path !== '' && (s.children[parent]?.indexOf(path) ?? 0) >= MAX_VISIBLE_CHILDREN) {
          showAll[parent] = true
        }

        return {
          expanded,
          showAll,
          selected: path,
          openFile: entry.kind === 'file' ? path : s.openFile,
          viewRequest: focusRequest(path)
        }
      })
    },

    selectFile(path) {
      set({ selected: path, openFile: path })
    },

    closeFile() {
      set({ openFile: null })
    },

    showAllChildren(path) {
      set((s) => ({ showAll: { ...s.showAll, [path]: true }, viewRequest: keepRequest(path) }))
    },

    collapseAll() {
      set({ expanded: { '': true }, viewRequest: fitRequest() })
    },

    async refresh() {
      const { project, expanded } = get()
      if (!project) return

      // Relistamos en un estado aparte y lo aplicamos de golpe para no redibujar el grafo por partes.
      const root = get().entries['']
      const entries: Record<string, FsEntry> = { '': root }
      const children: Record<string, string[]> = {}
      const stillExpanded: Flags = {}

      const dirs = Object.keys(expanded).sort((a, b) => depthOf(a) - depthOf(b))
      for (const dir of dirs) {
        // Si su carpeta padre no se relistó (colapsada o borrada), la descartamos.
        if (dir !== '' && entries[dir]?.kind !== 'directory') continue
        try {
          addListing(entries, children, dir, await window.api.listDir(dir))
          stillExpanded[dir] = true
        } catch {
          // Borrada o sin permisos: se queda colapsada.
        }
        if (get().project !== project) return
      }

      // Algo desapareció solo si su carpeta se relistó y ya no está; si no se relistó, lo conservamos.
      const keepIfExists = (p: string | null): string | null =>
        p !== null && (entries[p] || !children[parentOf(p)]) ? p : null

      set((s) => ({
        entries,
        children,
        expanded: stillExpanded,
        selected: keepIfExists(s.selected),
        openFile: keepIfExists(s.openFile),
        error: null
      }))
      void rebuildIndex()
    },

    setError(message) {
      set({ error: message })
    }
  }
})
