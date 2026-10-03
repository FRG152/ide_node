import { useEffect, useRef } from 'react'
import { FOCUS_EDITOR_EVENT } from '../graph/keyboard'
import { useEditorStore } from '../stores/editorStore'
import { attachWheelZoom, useZoomStore } from '../stores/zoomStore'
import { getDocument } from './documents'
import { CLAUDE_THEME, monaco } from './monaco'

/**
 * Una sola instancia de Monaco para todas las pestañas: al cambiar de archivo se cambia
 * el modelo y se restaura su estado de vista (cursor, scroll, plegados).
 */
export function CodeEditor({ path }: { path: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const shownPath = useRef<string | null>(null)
  const fontSize = useZoomStore((s) => s.fontSize.editor)

  useEffect(() => {
    const editor = monaco.editor.create(containerRef.current!, {
      model: null,
      theme: CLAUDE_THEME,
      automaticLayout: true,
      fontSize: useZoomStore.getState().fontSize.editor,
      fontFamily: 'Consolas, "Courier New", monospace',
      scrollBeyondLastLine: false,
      scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12, useShadows: false },
      fixedOverflowWidgets: true
    })
    editorRef.current = editor
    const detachWheelZoom = attachWheelZoom(containerRef.current!, 'editor')
    return () => {
      detachWheelZoom()
      rememberViewState(editor, shownPath.current)
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize })
  }, [fontSize])

  useEffect(() => {
    const focus = (): void => editorRef.current?.focus()
    window.addEventListener(FOCUS_EDITOR_EVENT, focus)
    return () => window.removeEventListener(FOCUS_EDITOR_EVENT, focus)
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    rememberViewState(editor, shownPath.current)

    const doc = path ? getDocument(path) : undefined
    if (doc?.kind === 'text') {
      editor.setModel(doc.model)
      if (doc.viewState) editor.restoreViewState(doc.viewState)
      editor.focus()
    } else {
      editor.setModel(null)
    }
    shownPath.current = path
  }, [path])

  // Después del efecto anterior (que pone el modelo): ir a la línea pedida (p. ej. por Claude).
  const pendingLine = useEditorStore((s) => s.pendingLine)
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || !pendingLine || pendingLine.path !== path) return
    const line = Math.min(pendingLine.line, model.getLineCount())
    editor.setSelection(new monaco.Selection(line, 1, line, model.getLineMaxColumn(line)))
    editor.revealLineInCenter(line)
    editor.focus()
    useEditorStore.getState().clearPendingLine()
  }, [path, pendingLine])

  return <div ref={containerRef} className="code-editor" hidden={path === null} />
}

function rememberViewState(editor: monaco.editor.IStandaloneCodeEditor, path: string | null): void {
  const doc = path ? getDocument(path) : undefined
  if (doc?.kind === 'text' && editor.getModel() === doc.model) doc.viewState = editor.saveViewState()
}
