/**
 * Contrato entre el proceso main y el renderer.
 *
 * El renderer nunca maneja rutas absolutas: todas las rutas son relativas a la
 * raíz del proyecto abierto, separadas por "/". La raíz es la cadena vacía "".
 */

export type EntryKind = 'file' | 'directory'

export interface FsEntry {
  path: string
  name: string
  kind: EntryKind
  /** Carpeta pesada (node_modules, dist, ...): se muestra pero no se indexa. */
  heavy?: boolean
}

export interface ProjectInfo {
  rootPath: string
  name: string
}

export interface IndexEntry {
  path: string
  kind: EntryKind
}

export interface ProjectIndex {
  rootPath: string
  entries: IndexEntry[]
  /** true si se alcanzó el límite de entradas y el índice está incompleto. */
  truncated: boolean
}

export type FileContent =
  | { kind: 'text'; content: string }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }

/** Cambios en disco detectados por el watcher, agrupados. */
export interface FsChanges {
  rootPath: string
  /** Rutas creadas, borradas o renombradas: hay que volver a listar su carpeta. */
  structural: string[]
  /** Archivos cuyo contenido cambió. */
  modified: string[]
}

export interface TerminalCreateOptions {
  /** Comando a ejecutar; la terminal termina cuando él termina. Sin comando: shell interactiva. */
  command?: string
  cols: number
  rows: number
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

export interface IdeApi {
  /** Carpeta indicada por línea de comandos al arrancar, si la hay. */
  initialProject(): Promise<ProjectInfo | null>
  openFolder(): Promise<ProjectInfo | null>
  listDir(path: string): Promise<FsEntry[]>
  buildIndex(): Promise<ProjectIndex>
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, content: string): Promise<void>
  /** Abre el archivo con la aplicación predeterminada del sistema. Devuelve un mensaje de error o "". */
  openPath(path: string): Promise<string>
  revealPath(path: string): Promise<void>
  /** Diálogo nativo "¿Guardar cambios?". */
  confirmUnsaved(paths: string[]): Promise<UnsavedChoice>
  onFsChanges(listener: (changes: FsChanges) => void): () => void

  terminalCreate(options: TerminalCreateOptions): Promise<number>
  terminalWrite(id: number, data: string): void
  terminalResize(id: number, cols: number, rows: number): void
  /** Mata la terminal y todos sus procesos hijos. */
  terminalKill(id: number): Promise<void>
  onTerminalData(listener: (id: number, data: string) => void): () => void
  onTerminalExit(listener: (id: number, exitCode: number) => void): () => void
}

export const IPC = {
  initialProject: 'project:initial',
  openFolder: 'project:open-folder',
  listDir: 'fs:list-dir',
  buildIndex: 'fs:build-index',
  readFile: 'fs:read-file',
  writeFile: 'fs:write-file',
  fsChanges: 'fs:changes',
  openPath: 'shell:open-path',
  revealPath: 'shell:reveal-path',
  confirmUnsaved: 'ui:confirm-unsaved',
  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit'
} as const
