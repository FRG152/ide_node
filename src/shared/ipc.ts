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

export type FilePreview =
  | { kind: 'text'; size: number; content: string; truncated: boolean }
  | { kind: 'binary'; size: number }

export interface IdeApi {
  /** Carpeta indicada por línea de comandos al arrancar, si la hay. */
  initialProject(): Promise<ProjectInfo | null>
  openFolder(): Promise<ProjectInfo | null>
  listDir(path: string): Promise<FsEntry[]>
  buildIndex(): Promise<ProjectIndex>
  readFile(path: string): Promise<FilePreview>
  /** Abre el archivo con la aplicación predeterminada del sistema. Devuelve un mensaje de error o "". */
  openPath(path: string): Promise<string>
  revealPath(path: string): Promise<void>
}

export const IPC = {
  initialProject: 'project:initial',
  openFolder: 'project:open-folder',
  listDir: 'fs:list-dir',
  buildIndex: 'fs:build-index',
  readFile: 'fs:read-file',
  openPath: 'shell:open-path',
  revealPath: 'shell:reveal-path'
} as const
