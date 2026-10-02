/**
 * Contrato entre el proceso main y el renderer.
 *
 * El renderer nunca maneja rutas absolutas: todas las rutas son relativas a la
 * raíz del proyecto abierto, separadas por "/". La raíz es la cadena vacía "".
 */

export type Language = 'en' | 'es'

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
  /** Lanza Claude Code (interactivo) conectado a la app: MCP de la interfaz, hooks e instrucciones. */
  claude?: boolean
  cols: number
  rows: number
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/**
 * Servidor MCP de la app. Ojo: "ide" está reservado en Claude Code (su integración con
 * VS Code/JetBrains filtra las herramientas de un servidor con ese nombre).
 */
export const IDE_MCP_SERVER = 'ide_node'
/** Así llegan a Claude las herramientas de ese servidor: `mcp__ide_node__open_file`, etc. */
export const IDE_TOOL_PREFIX = `mcp__${IDE_MCP_SERVER}__`

/**
 * Acciones que Claude puede hacer en la interfaz (vía el servidor MCP del main).
 * Rutas relativas a la raíz del proyecto ("" = raíz).
 */
export type IdeCommand =
  | { type: 'expand_folder'; path: string }
  | { type: 'collapse_folder'; path: string }
  | { type: 'select_node'; path: string }
  | { type: 'open_file'; path: string; line?: number }
  | { type: 'get_view' }

/** Qué hace Claude con un archivo, para resaltarlo en el grafo. */
export type ClaudeFileAccess = 'read' | 'edit'

/** Tokens de la conversación con Claude (leídos de su transcripción). */
export interface ClaudeUsage {
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

/**
 * Lo que la app sabe de la sesión de Claude Code que corre en la terminal. Llega por sus
 * hooks (ver main/claudeCode.ts), ya simplificado por el main.
 */
export type ClaudeEvent =
  /** El usuario envió un mensaje o Claude sigue con una herramienta. */
  | { type: 'working' }
  /** Claude terminó su turno. */
  | { type: 'idle' }
  /** Claude espera al usuario (p. ej. un permiso). */
  | { type: 'attention'; message: string }
  /** Claude usa una herramienta. `path` es relativo al proyecto si la herramienta toca un archivo de él. */
  | { type: 'tool'; name: string; detail: string; path: string | null; access: ClaudeFileAccess | null }
  /** Modelo, contexto en uso (y ventana del modelo, si se conoce) y tokens acumulados. */
  | { type: 'usage'; model: string | null; contextTokens: number; contextWindow: number | null; usage: ClaudeUsage }

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
  /** Idioma de los diálogos y errores del main. */
  setLanguage(language: Language): void
  /** Zoom de toda la ventana (nivel de Electron: 0 = 100%, cada paso ×1.2). */
  setZoomLevel(level: number): void
  /** Escribe ya a disco el localStorage (Chromium lo hace con retraso y se pierde si el proceso muere). */
  flushStorage(): void
  /** Diálogo nativo "¿Guardar cambios?". */
  confirmUnsaved(paths: string[]): Promise<UnsavedChoice>
  onFsChanges(listener: (changes: FsChanges) => void): () => void

  /** Eventos de la sesión de Claude Code que corre en la terminal. */
  onClaudeEvent(listener: (event: ClaudeEvent) => void): () => void

  /** El main pide al renderer ejecutar una acción de Claude; se responde con `ideCommandResult`. */
  onIdeCommand(listener: (id: number, command: IdeCommand) => void): () => void
  ideCommandResult(id: number, ok: boolean, text: string): void

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
  flushStorage: 'app:flush-storage',
  setLanguage: 'app:set-language',
  claudeEvent: 'claude:event',
  ideCommand: 'ide:command',
  ideCommandResult: 'ide:command-result',
  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit'
} as const
