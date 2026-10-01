/** Textos del proceso main (diálogos nativos, menú y errores que ve el usuario). */
import type { Language } from '../shared/ipc'

const en = {
  'menu.view': 'View',
  'dialog.openFolder': 'Open project folder',
  'dialog.unsaved.one': 'Do you want to save the changes you made to {path}?',
  'dialog.unsaved.many': 'Do you want to save the changes you made to {count} files?',
  'dialog.unsaved.detail': "Your changes will be lost if you don't save them.",
  'dialog.unsaved.save': 'Save',
  'dialog.unsaved.discard': "Don't save",
  'dialog.unsaved.cancel': 'Cancel',
  'dialog.leave.message': 'Some files have unsaved changes.',
  'dialog.leave.detail': 'If you continue, they will be lost.',
  'dialog.leave.discard': 'Discard changes',
  'dialog.leave.cancel': 'Cancel',
  'error.noProject': 'No project is open',
  'error.invalidPath': 'Invalid path',
  'error.outsideProject': 'Path outside the project: {path}',
  'error.invalidContent': 'Invalid content',
  'error.emptyMessage': 'Empty message',
  'error.noWindow': 'The app window is not open',
  'error.uiTimeout': 'The interface did not respond in time',
  'claude.notFound': 'The "claude" command was not found. Install Claude Code and reopen the app.',
  'claude.stopped': 'Stopped.',
  'claude.noResponse': 'Claude exited without an answer (code {code}).'
}

type Key = keyof typeof en

const es: Record<Key, string> = {
  'menu.view': 'Ver',
  'dialog.openFolder': 'Abrir carpeta de proyecto',
  'dialog.unsaved.one': '¿Quieres guardar los cambios de {path}?',
  'dialog.unsaved.many': '¿Quieres guardar los cambios de {count} archivos?',
  'dialog.unsaved.detail': 'Si no los guardas, se perderán.',
  'dialog.unsaved.save': 'Guardar',
  'dialog.unsaved.discard': 'No guardar',
  'dialog.unsaved.cancel': 'Cancelar',
  'dialog.leave.message': 'Hay archivos con cambios sin guardar.',
  'dialog.leave.detail': 'Si continúas, se perderán.',
  'dialog.leave.discard': 'Descartar cambios',
  'dialog.leave.cancel': 'Cancelar',
  'error.noProject': 'No hay ningún proyecto abierto',
  'error.invalidPath': 'Ruta inválida',
  'error.outsideProject': 'Ruta fuera del proyecto: {path}',
  'error.invalidContent': 'Contenido inválido',
  'error.emptyMessage': 'Mensaje vacío',
  'error.noWindow': 'La ventana de la app no está abierta',
  'error.uiTimeout': 'La interfaz no respondió a tiempo',
  'claude.notFound': 'No se encontró el comando "claude". Instala Claude Code y vuelve a abrir la app.',
  'claude.stopped': 'Detenido.',
  'claude.noResponse': 'Claude terminó sin respuesta (código {code}).'
}

const DICTIONARIES: Record<Language, Record<Key, string>> = { en, es }

/** Lo fija el renderer al arrancar y cuando el usuario cambia de idioma. */
let language: Language = 'en'

export function setLanguage(next: Language): void {
  if (next in DICTIONARIES) language = next
}

export function t(key: Key, params?: Record<string, string | number>): string {
  const text = DICTIONARIES[language][key]
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text
}
