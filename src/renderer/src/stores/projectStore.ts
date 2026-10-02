import { create } from 'zustand'
import type { FsChanges, FsEntry, IndexEntry, ProjectInfo } from '../../../shared/ipc'
import { t } from '../i18n'
import { errorMessage } from '../lib/errors'
import { ancestorsOf, depthOf, parentOf } from '../lib/paths'
import { useEditorStore } from './editorStore'
import { useTerminalStore } from './terminalStore'

/** Máximo de hijos que se dibujan por carpeta antes de mostrar un nodo "+N más". */
export const MAX_VISIBLE_CHILDREN = 100

/** Tras cambios en disco, esperamos a que se calmen antes de reindexar el proyecto entero. */
const REINDEX_DELAY_MS = 1000

type Flags = Record<string, true>

/**
 * Petición de movimiento de cámara para el grafo:
 * - fit: encuadrar todo el árbol.
 * - focus: centrar un nodo (animado). Con `ifHidden`, solo si no está a la vista.
 * - keep: tras un cambio de layout, dejar ese nodo en el mismo punto de la pantalla.
 */
export type ViewRequest = { id: number } & (
  | { kind: 'fit' }
  | { kind: 'focus'; path: string; ifHidden?: boolean }
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
  index: IndexEntry[]
  indexing: boolean
  indexTruncated: boolean
  /** Scripts del package.json de la raíz. */
  scripts: Record<string, string>
  /** Petición pendiente para mover la cámara del grafo. */
  viewRequest: ViewRequest | null
  error: string | null

  openFolder: () => Promise<void>
  openInitialProject: () => Promise<void>
  toggleFolder: (path: string) => Promise<void>
  /**
   * Expande hasta `path`, lo selecciona y centra la cámara. Si es un archivo, por defecto
   * también lo abre en el editor.
   */
  reveal: (path: string, options?: { openFile?: boolean }) => Promise<void>
  /** Carga los listados hasta `path` (sin expandir nada en la vista) y devuelve su entrada, si existe. */
  ensureLoaded: (path: string) => Promise<FsEntry | null>
  /** Expande las carpetas hasta `path` sin cambiar la selección ni mover la cámara. */
  expandTo: (path: string) => Promise<void>
  select: (path: string | null) => void
  /** Selecciona el nodo y centra la cámara en él. */
  focus: (path: string) => void
  /** Selecciona el nodo y mueve la cámara solo si quedó fuera de la vista. */
  ensureVisible: (path: string) => void
  showAllChildren: (path: string) => void
  collapseAll: () => void
  refresh: () => Promise<void>
  applyFsChanges: (changes: FsChanges) => Promise<void>
  setError: (message: string | null) => void
}

let nextRequestId = 1
const fitRequest = (): ViewRequest => ({ id: nextRequestId++, kind: 'fit' })
const focusRequest = (path: string, ifHidden = false): ViewRequest => ({
  id: nextRequestId++,
  kind: 'focus',
  path,
  ifHidden
})
const keepRequest = (path: string): ViewRequest => ({ id: nextRequestId++, kind: 'keep', path })

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...record }
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

function parseScripts(packageJson: string): Record<string, string> {
  try {
    const scripts = (JSON.parse(packageJson) as { scripts?: unknown }).scripts
    if (!scripts || typeof scripts !== 'object') return {}
    return Object.fromEntries(Object.entries(scripts).filter(([, cmd]) => typeof cmd === 'string'))
  } catch {
    return {} // package.json a medio escribir o inválido
  }
}

const emptyProjectState = {
  entries: {},
  children: {},
  expanded: {},
  showAll: {},
  selected: null,
  index: [],
  indexing: false,
  indexTruncated: false,
  scripts: {},
  viewRequest: null,
  error: null
}

export const useProjectStore = create<ProjectState>()((set, get) => {
  let reindexTimer: ReturnType<typeof setTimeout> | null = null

  /** Lista una carpeta si aún no está cargada. Devuelve false si falló o cambió el proyecto. */
  async function loadChildren(dir: string): Promise<boolean> {
    const project = get().project
    if (!project) return false
    if (get().children[dir]) return true

    let list: FsEntry[]
    try {
      list = await window.api.listDir(dir)
    } catch (err) {
      if (get().project === project) set({ error: t('error.read', { path: dir || project.name, message: errorMessage(err) }) })
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
      if (get().project === project) set({ indexing: false, error: t('error.index', { message: errorMessage(err) }) })
    }
  }

  function scheduleReindex(): void {
    if (reindexTimer) clearTimeout(reindexTimer)
    reindexTimer = setTimeout(() => {
      reindexTimer = null
      void rebuildIndex()
    }, REINDEX_DELAY_MS)
  }

  async function loadScripts(): Promise<void> {
    const project = get().project
    if (!project) return
    let scripts: Record<string, string> = {}
    try {
      const file = await window.api.readFile('package.json')
      if (file.kind === 'text') scripts = parseScripts(file.content)
    } catch {
      // sin package.json: proyecto que no es de Node
    }
    if (get().project === project) set({ scripts })
  }

  async function loadProject(info: ProjectInfo): Promise<void> {
    useEditorStore.getState().closeAll()
    useTerminalStore.getState().reset()
    set({
      ...emptyProjectState,
      project: info,
      entries: { '': { path: '', name: info.name, kind: 'directory' } },
      expanded: { '': true }
    })
    await loadChildren('')
    if (get().project === info) set({ viewRequest: fitRequest() })
    void rebuildIndex()
    void loadScripts()
  }

  return {
    project: null,
    ...emptyProjectState,

    async openFolder() {
      try {
        if (!(await useEditorStore.getState().confirmCloseAll())) return
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

    async reveal(path, { openFile = true } = {}) {
      const ancestors = ancestorsOf(path)
      for (const dir of ancestors) {
        if (!(await loadChildren(dir))) return
      }

      const entry = get().entries[path]
      if (!entry) {
        set({ error: t('error.missing', { path }) })
        return
      }

      // Primero el editor: si es la primera pestaña, el grafo se estrecha, y así el
      // centrado de abajo ya se calcula con el tamaño final del lienzo.
      if (entry.kind === 'file' && openFile) await useEditorStore.getState().open(path)

      set((s) => {
        const expanded = { ...s.expanded }
        for (const dir of ancestors) expanded[dir] = true

        // Si el nodo quedaría oculto tras el "+N más", mostramos todos los hijos de su carpeta.
        const showAll = { ...s.showAll }
        const parent = parentOf(path)
        if (path !== '' && (s.children[parent]?.indexOf(path) ?? 0) >= MAX_VISIBLE_CHILDREN) {
          showAll[parent] = true
        }

        return { expanded, showAll, selected: path, viewRequest: focusRequest(path) }
      })
    },

    async ensureLoaded(path) {
      for (const dir of ancestorsOf(path)) {
        if (!(await loadChildren(dir))) return null
      }
      return get().entries[path] ?? null
    },

    async expandTo(path) {
      const ancestors = ancestorsOf(path)
      for (const dir of ancestors) {
        if (!(await loadChildren(dir))) return
      }
      if (ancestors.every((dir) => get().expanded[dir])) return
      set((s) => {
        const expanded = { ...s.expanded }
        for (const dir of ancestors) expanded[dir] = true
        const showAll = { ...s.showAll }
        const parent = parentOf(path)
        if ((s.children[parent]?.indexOf(path) ?? 0) >= MAX_VISIBLE_CHILDREN) showAll[parent] = true
        // El layout cambia: que no salte lo que el usuario está mirando.
        return { expanded, showAll, viewRequest: keepRequest(s.selected ?? '') }
      })
    },

    select(path) {
      set({ selected: path })
    },

    focus(path) {
      set({ selected: path, viewRequest: focusRequest(path) })
    },

    ensureVisible(path) {
      set({ selected: path, viewRequest: focusRequest(path, true) })
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
        error: null
      }))
      void rebuildIndex()
      void loadScripts()
    },

    async applyFsChanges({ rootPath, structural, modified }) {
      const project = get().project
      if (!project || project.rootPath !== rootPath) return

      if (structural.length > 0) {
        // Solo relistamos carpetas que ya estaban cargadas; el resto se listará al abrirlas.
        const dirs = [...new Set(structural.map(parentOf))].filter((dir) => get().children[dir])
        const listings = await Promise.all(
          dirs.map((dir) =>
            window.api.listDir(dir).then(
              (list) => ({ dir, list }),
              () => ({ dir, list: null }) // la carpeta ya no existe
            )
          )
        )
        if (get().project !== project) return

        if (listings.length > 0) {
          set((s) => {
            const entries = { ...s.entries }
            let children = { ...s.children }
            let expanded = s.expanded
            for (const { dir, list } of listings) {
              if (list) {
                addListing(entries, children, dir, list)
              } else {
                children = without(children, dir)
                expanded = without(expanded, dir)
              }
            }
            // El layout se recoloca: mantenemos quieto el nodo que el usuario está mirando.
            return { entries, children, expanded, viewRequest: keepRequest(s.selected ?? '') }
          })
        }
        scheduleReindex()
      }

      const touched = [...structural, ...modified]
      if (touched.includes('package.json')) void loadScripts()
      await useEditorStore.getState().syncFromDisk(touched)
    },

    setError(message) {
      set({ error: message })
    }
  }
})
