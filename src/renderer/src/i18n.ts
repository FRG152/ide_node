/**
 * Textos de la interfaz. Inglés por defecto; el usuario puede cambiar a español desde la
 * barra de estado. El main tiene su propio diccionario (diálogos y errores) y se le avisa
 * del idioma elegido.
 */
import { create } from 'zustand'
import type { Language } from '../../shared/ipc'
import { loadSetting, saveSetting } from './lib/settings'

const en = {
  // Barra superior
  'toolbar.openFolder': 'Open folder',
  'toolbar.openFolderTitle': 'Open folder (Ctrl+O)',
  'toolbar.noProject': 'No project',
  'toolbar.collapseAll': 'Collapse all',
  'toolbar.autoCollapse': 'Auto-collapse',
  'toolbar.autoCollapseTitle': 'Opening a folder closes the ones outside its branch, so a large project stays readable',
  'toolbar.refresh': 'Refresh',
  'toolbar.terminal': 'Terminal',
  'toolbar.hideTerminal': 'Hide terminal',
  'toolbar.terminalTitle': 'Show/hide terminal (Ctrl+J)',
  'toolbar.keyboard': 'Keyboard mode: move through the graph with the arrows (Ctrl+Shift+E)',
  // Modo teclado
  'keys.title': 'Keyboard mode',
  'keys.move': 'move',
  'keys.left': 'collapse / parent',
  'keys.right': 'expand / child',
  'keys.open': 'open',
  'keys.root': 'root',
  'keys.zoom': 'zoom',
  'keys.cycle': 'switch file',
  'keys.exit': 'exit',
  // Buscador
  'search.placeholder': 'Search files and folders (Ctrl+P)',
  'search.noProject': 'Open a folder to search',
  'search.indexing': 'Indexing…',
  'search.noResults': 'No results',
  // Bienvenida
  'welcome.text': 'Open a folder to see it as a graph of nodes and work on it with Claude.',
  'welcome.button': 'Open folder (Ctrl+O)',
  // Barra de estado
  'status.ready': 'Ready',
  'status.indexing': 'Indexing project…',
  'status.counts': '{files} files · {folders} folders',
  'status.truncated': ' (partial index)',
  'status.unsaved': '● {count} unsaved',
  'status.zoom': 'Zoom {percent}%',
  'status.zoomTitle': 'Reset zoom (Ctrl+0)',
  'status.fontEditor': 'Editor {percent}%',
  'status.fontTerminal': 'Terminal {percent}%',
  'status.fontTitle': 'Font size changed with Ctrl+wheel. Click to reset.',
  'status.dismiss': 'Dismiss',
  'status.languageTitle': 'Interface language',
  // Editor
  'editor.unsaved': 'Unsaved changes',
  'editor.reveal': 'Show in folder',
  'editor.revealTitle': 'Show in the file explorer',
  'editor.minimize': 'Minimize (Esc)',
  'editor.close': 'Close (Ctrl+W)',
  'editor.zoomIn': 'Larger text (Ctrl+wheel)',
  'editor.zoomOut': 'Smaller text (Ctrl+wheel)',
  'editor.zoomReset': 'Reset text size',
  'editor.maximize': 'Maximize (double-click the title bar)',
  'editor.restore': 'Restore size (double-click the title bar)',
  'editor.resize': 'Drag to resize',
  'editor.binary': "Binary file ({size}): it can't be edited here.",
  'editor.tooLarge': 'File too large for the editor ({size}).',
  'editor.openError': 'Could not open it: {message}',
  'editor.openWithSystem': 'Open with the system app',
  'editor.openFailed': 'Could not open "{path}": {message}',
  'minimized.title': '{path}\nClick to open · middle-click to close',
  'minimized.close': 'Close',
  // Grafo
  'node.more': '+{count} more…',
  'node.moreTitle': 'Show every item in this folder',
  'node.claudeInside': 'Claude touched files in this folder',
  'breadcrumbs.label': 'Path of the selected node',
  // Terminal
  'terminal.interactive': 'Interactive shell',
  'terminal.closeKill': 'Close and kill the process',
  'terminal.close': 'Close',
  'terminal.new': 'New terminal',
  'terminal.stop': '■ Stop',
  'terminal.restart': '↻ Restart',
  'terminal.hide': 'Hide panel (Ctrl+J)',
  'terminal.empty': 'No terminals. Press + or run a script.',
  'terminal.name': 'Terminal {n}',
  'terminal.exited': '[Process exited with code {code}]',
  'terminal.openFailed': 'Could not open the terminal: {message}',
  'terminal.claude': 'Claude',
  // Claude Code en la terminal
  'claude.open': 'Open Claude in the terminal (Ctrl+I)',
  'claude.status.off': 'Claude is not running',
  'claude.status.idle': 'Claude is ready',
  'claude.status.working': 'Claude is working',
  'claude.status.attention': 'Claude needs you',
  'claude.label.off': 'Ctrl+I to start',
  'claude.label.attention': 'needs you',
  'usage.tokensTitle': 'This conversation\nInput: {input}\nCache read: {cacheRead}\nCache write: {cacheWrite}\nOutput: {output}',
  // Claude: herramientas (lo que está haciendo)
  'tool.Read': 'Read',
  'tool.Edit': 'Edit',
  'tool.Write': 'Write',
  'tool.NotebookEdit': 'Edit',
  'tool.Grep': 'Search',
  'tool.Glob': 'Find files',
  'tool.Bash': 'Run',
  'tool.PowerShell': 'Run',
  'tool.WebFetch': 'Fetch',
  'tool.WebSearch': 'Web search',
  'tool.Task': 'Subagent',
  'tool.Agent': 'Subagent',
  'tool.TodoWrite': 'Plan',
  'tool.expand_folder': 'Open folder',
  'tool.collapse_folder': 'Close folder',
  'tool.select_node': 'Select',
  'tool.open_file': 'Open',
  'tool.get_view': 'Check view',
  'tool.root': '(root)',
  // Claude: uso (arriba a la izquierda)
  'usage.claude': 'Claude',
  'usage.contextTitle': 'Context in use: {used} of {window} tokens ({percent}%)',
  'usage.contextUnknown': 'Context: {used} tokens',
  'usage.tokens': '{count} tokens',
  // Errores
  'error.read': 'Could not read "{path}": {message}',
  'error.index': 'Indexing error: {message}',
  'error.missing': '"{path}" no longer exists. Press "Refresh" to update the project.',
  'error.save': 'Could not save "{path}": {message}'
}

export type MessageKey = keyof typeof en

export function isMessageKey(key: string): key is MessageKey {
  return key in en
}

const es: Record<MessageKey, string> = {
  'toolbar.openFolder': 'Abrir carpeta',
  'toolbar.openFolderTitle': 'Abrir carpeta (Ctrl+O)',
  'toolbar.noProject': 'Sin proyecto',
  'toolbar.collapseAll': 'Colapsar todo',
  'toolbar.autoCollapse': 'Auto-colapsar',
  'toolbar.autoCollapseTitle': 'Al abrir una carpeta se cierran las que no están en su rama, para que un proyecto grande siga legible',
  'toolbar.refresh': 'Refrescar',
  'toolbar.terminal': 'Terminal',
  'toolbar.hideTerminal': 'Ocultar terminal',
  'toolbar.terminalTitle': 'Mostrar/ocultar terminal (Ctrl+J)',
  'toolbar.keyboard': 'Modo teclado: recorre el grafo con las flechas (Ctrl+Shift+E)',
  'keys.title': 'Modo teclado',
  'keys.move': 'moverse',
  'keys.left': 'colapsar / padre',
  'keys.right': 'expandir / hijo',
  'keys.open': 'abrir',
  'keys.root': 'raíz',
  'keys.zoom': 'zoom',
  'keys.cycle': 'cambiar de archivo',
  'keys.exit': 'salir',
  'search.placeholder': 'Buscar archivo o carpeta (Ctrl+P)',
  'search.noProject': 'Abre una carpeta para buscar',
  'search.indexing': 'Indexando…',
  'search.noResults': 'Sin resultados',
  'welcome.text': 'Abre una carpeta para verla como un grafo de nodos y trabajar en ella con Claude.',
  'welcome.button': 'Abrir carpeta (Ctrl+O)',
  'status.ready': 'Listo',
  'status.indexing': 'Indexando proyecto…',
  'status.counts': '{files} archivos · {folders} carpetas',
  'status.truncated': ' (índice incompleto)',
  'status.unsaved': '● {count} sin guardar',
  'status.zoom': 'Zoom {percent}%',
  'status.zoomTitle': 'Restablecer zoom (Ctrl+0)',
  'status.fontEditor': 'Editor {percent}%',
  'status.fontTerminal': 'Terminal {percent}%',
  'status.fontTitle': 'Letra cambiada con Ctrl+rueda. Clic para restablecer.',
  'status.dismiss': 'Descartar',
  'status.languageTitle': 'Idioma de la interfaz',
  'editor.unsaved': 'Cambios sin guardar',
  'editor.reveal': 'Mostrar en carpeta',
  'editor.revealTitle': 'Mostrar en el explorador de archivos',
  'editor.minimize': 'Minimizar (Esc)',
  'editor.close': 'Cerrar (Ctrl+W)',
  'editor.zoomIn': 'Letra más grande (Ctrl+rueda)',
  'editor.zoomOut': 'Letra más pequeña (Ctrl+rueda)',
  'editor.zoomReset': 'Restablecer tamaño de letra',
  'editor.maximize': 'Maximizar (doble clic en la barra de título)',
  'editor.restore': 'Restaurar tamaño (doble clic en la barra de título)',
  'editor.resize': 'Arrastra para cambiar el ancho',
  'editor.binary': 'Archivo binario ({size}): no se puede editar aquí.',
  'editor.tooLarge': 'Archivo demasiado grande para el editor ({size}).',
  'editor.openError': 'No se pudo abrir: {message}',
  'editor.openWithSystem': 'Abrir con la aplicación del sistema',
  'editor.openFailed': 'No se pudo abrir "{path}": {message}',
  'minimized.title': '{path}\nClic para abrir · clic central para cerrar',
  'minimized.close': 'Cerrar',
  'node.more': '+{count} más…',
  'node.moreTitle': 'Mostrar todos los elementos de esta carpeta',
  'node.claudeInside': 'Claude ha tocado archivos de esta carpeta',
  'breadcrumbs.label': 'Ruta del nodo seleccionado',
  'terminal.interactive': 'Shell interactiva',
  'terminal.closeKill': 'Cerrar y matar el proceso',
  'terminal.close': 'Cerrar',
  'terminal.new': 'Nueva terminal',
  'terminal.stop': '■ Detener',
  'terminal.restart': '↻ Reiniciar',
  'terminal.hide': 'Ocultar panel (Ctrl+J)',
  'terminal.empty': 'Sin terminales. Pulsa + o ejecuta un script.',
  'terminal.name': 'Terminal {n}',
  'terminal.exited': '[Proceso terminado con código {code}]',
  'terminal.openFailed': 'No se pudo abrir la terminal: {message}',
  'terminal.claude': 'Claude',
  'claude.open': 'Abrir Claude en la terminal (Ctrl+I)',
  'claude.status.off': 'Claude no está en marcha',
  'claude.status.idle': 'Claude está listo',
  'claude.status.working': 'Claude está trabajando',
  'claude.status.attention': 'Claude te necesita',
  'claude.label.off': 'Ctrl+I para empezar',
  'claude.label.attention': 'te necesita',
  'usage.tokensTitle': 'Esta conversación\nEntrada: {input}\nLectura de caché: {cacheRead}\nEscritura de caché: {cacheWrite}\nSalida: {output}',
  'tool.Read': 'Lee',
  'tool.Edit': 'Edita',
  'tool.Write': 'Escribe',
  'tool.NotebookEdit': 'Edita',
  'tool.Grep': 'Busca',
  'tool.Glob': 'Busca archivos',
  'tool.Bash': 'Ejecuta',
  'tool.PowerShell': 'Ejecuta',
  'tool.WebFetch': 'Consulta',
  'tool.WebSearch': 'Busca en la web',
  'tool.Task': 'Subagente',
  'tool.Agent': 'Subagente',
  'tool.TodoWrite': 'Planifica',
  'tool.expand_folder': 'Abre carpeta',
  'tool.collapse_folder': 'Cierra carpeta',
  'tool.select_node': 'Selecciona',
  'tool.open_file': 'Abre',
  'tool.get_view': 'Mira tu vista',
  'tool.root': '(raíz)',
  'usage.claude': 'Claude',
  'usage.contextTitle': 'Contexto en uso: {used} de {window} tokens ({percent}%)',
  'usage.contextUnknown': 'Contexto: {used} tokens',
  'usage.tokens': '{count} tokens',
  'error.read': 'No se pudo leer "{path}": {message}',
  'error.index': 'Error indexando: {message}',
  'error.missing': '"{path}" ya no existe. Pulsa "Refrescar" para actualizar el proyecto.',
  'error.save': 'No se pudo guardar "{path}": {message}'
}

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, es }
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', es: 'Español' }
const STORAGE_KEY = 'ide-node:language'

function loadLanguage(): Language {
  const saved = loadSetting(STORAGE_KEY)
  return saved === 'es' || saved === 'en' ? saved : 'en'
}

interface LanguageState {
  language: Language
  setLanguage: (language: Language) => void
}

export const useLanguageStore = create<LanguageState>()((set) => ({
  language: loadLanguage(),
  setLanguage(language) {
    set({ language })
    window.api.setLanguage(language)
    saveSetting(STORAGE_KEY, language)
  }
}))

// El main traduce sus diálogos y errores.
window.api.setLanguage(useLanguageStore.getState().language)

export type Params = Record<string, string | number>

/** Texto en el idioma actual. Fuera de React (stores, eventos): el idioma de ese momento. */
export function t(key: MessageKey, params?: Params): string {
  const text = DICTIONARIES[useLanguageStore.getState().language][key] ?? en[key]
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text
}

/** Igual que `t`, pero el componente se vuelve a renderizar al cambiar de idioma. */
export function useT(): typeof t {
  useLanguageStore((s) => s.language)
  return t
}

/** "12.3k", "1M"... para contadores de tokens. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
