/**
 * Documentos abiertos en el editor. Viven fuera de React/zustand porque los modelos
 * de Monaco no son serializables; el store solo guarda qué pestañas hay y cuáles
 * tienen cambios sin guardar.
 */
import { errorMessage } from '../lib/errors'
import { monaco } from './monaco'

export type Document =
  | {
      kind: 'text'
      model: monaco.editor.ITextModel
      /** Versión del modelo que coincide con el disco. Distinta = cambios sin guardar. */
      savedVersionId: number
      viewState: monaco.editor.ICodeEditorViewState | null
      subscription: monaco.IDisposable
    }
  | { kind: 'binary' | 'too-large'; size: number }
  | { kind: 'error'; message: string }

const documents = new Map<string, Document>()
const loading = new Map<string, Promise<Document>>()

export function getDocument(path: string): Document | undefined {
  return documents.get(path)
}

export function isDirty(doc: Document | undefined): boolean {
  return doc?.kind === 'text' && doc.model.getAlternativeVersionId() !== doc.savedVersionId
}

/** Carga el archivo (una sola vez aunque se pida varias). `onDirtyChange` se llama en cada edición. */
export function loadDocument(path: string, onDirtyChange: (dirty: boolean) => void): Promise<Document> {
  const existing = documents.get(path)
  if (existing) return Promise.resolve(existing)

  let pending = loading.get(path)
  if (!pending) {
    pending = read(path, onDirtyChange).finally(() => loading.delete(path))
    loading.set(path, pending)
  }
  return pending
}

async function read(path: string, onDirtyChange: (dirty: boolean) => void): Promise<Document> {
  let doc: Document
  try {
    const file = await window.api.readFile(path)
    if (file.kind === 'text') {
      // La extensión de la URI decide el lenguaje (resaltado, autocompletado...).
      const model = monaco.editor.createModel(file.content, undefined, monaco.Uri.file('/' + path))
      const textDoc: Document = {
        kind: 'text',
        model,
        savedVersionId: model.getAlternativeVersionId(),
        viewState: null,
        subscription: model.onDidChangeContent(() => onDirtyChange(isDirty(textDoc)))
      }
      doc = textDoc
    } else {
      doc = file
    }
  } catch (err) {
    doc = { kind: 'error', message: errorMessage(err) }
  }
  documents.set(path, doc)
  return doc
}

export async function saveDocument(path: string): Promise<void> {
  const doc = documents.get(path)
  if (doc?.kind !== 'text') return
  const version = doc.model.getAlternativeVersionId()
  await window.api.writeFile(path, doc.model.getValue())
  doc.savedVersionId = version
}

/**
 * El archivo cambió en disco (git, formateador, otro editor...). Si no hay cambios
 * locales, cargamos la versión nueva; si los hay, no pisamos el trabajo del usuario.
 * Devuelve true si el documento se actualizó.
 */
export async function reloadDocument(path: string): Promise<boolean> {
  const doc = documents.get(path)
  if (doc?.kind !== 'text' || isDirty(doc)) return false

  let file
  try {
    file = await window.api.readFile(path)
  } catch {
    return false // borrado: mantenemos el contenido por si el usuario quiere volver a guardarlo
  }
  if (file.kind !== 'text' || isDirty(doc) || file.content === doc.model.getValue()) return false

  // Como edición (y no setValue) para que se pueda deshacer.
  doc.model.pushEditOperations([], [{ range: doc.model.getFullModelRange(), text: file.content }], () => null)
  doc.savedVersionId = doc.model.getAlternativeVersionId()
  return true
}

export function closeDocument(path: string): void {
  const doc = documents.get(path)
  if (doc?.kind === 'text') {
    doc.subscription.dispose()
    doc.model.dispose()
  }
  documents.delete(path)
}
