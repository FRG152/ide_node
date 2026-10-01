import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { t, useT } from '../i18n'
import { errorMessage } from '../lib/errors'
import { classes } from '../lib/classes'
import { colorForFile } from '../lib/fileColors'
import { baseName, formatSize, parentOf } from '../lib/paths'
import { useEditorStore } from '../stores/editorStore'
import { MIN_EDITOR_WIDTH, useEditorLayoutStore } from '../stores/editorLayoutStore'
import { DEFAULT_FONT_SIZE, useZoomStore } from '../stores/zoomStore'
import { useProjectStore } from '../stores/projectStore'
import { CodeEditor } from './CodeEditor'
import { getDocument, type Document } from './documents'

function reportError(err: unknown): void {
  useProjectStore.getState().setError(errorMessage(err))
}

/** Ventana flotante centrada sobre el grafo con el archivo activo. */
export function EditorWindow() {
  const t = useT()
  const { active, dirty, minimize, close } = useEditorStore(
    useShallow((s) => ({
      active: s.active,
      dirty: s.active !== null && s.dirty[s.active] === true,
      minimize: s.minimize,
      close: s.close
    }))
  )
  const { width, maximized, setWidth, toggleMaximized } = useEditorLayoutStore()
  const fontSize = useZoomStore((s) => s.fontSize.editor)
  const { zoomFont, resetFont } = useZoomStore()
  const windowRef = useRef<HTMLDivElement>(null)
  /** Ancho mientras se arrastra un borde (se guarda al soltar). */
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  if (!active) return null
  const doc = getDocument(active)

  // La ventana está centrada: arrastrar un borde la ensancha hacia los dos lados.
  const startResize = (direction: 1 | -1) => (e: PointerEvent<HTMLDivElement>) => {
    const el = windowRef.current
    if (!el || e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = el.getBoundingClientRect().width
    const maxWidth = (el.parentElement?.clientWidth ?? startWidth) - 24
    let current = startWidth
    const onMove = (ev: globalThis.PointerEvent): void => {
      current = Math.min(maxWidth, Math.max(MIN_EDITOR_WIDTH, startWidth + direction * (ev.clientX - startX) * 2))
      setDragWidth(current)
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      setDragWidth(null)
      setWidth(current)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  const shownWidth = dragWidth ?? width
  const fontPercent = Math.round((fontSize / DEFAULT_FONT_SIZE) * 100)

  // Esc minimiza. Llega aquí solo si Monaco no lo usó (cerrar el buscador, sugerencias...),
  // porque en ese caso detiene la propagación.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !e.defaultPrevented) minimize()
  }

  return (
    <div
      ref={windowRef}
      className={classes('editor-window', maximized && dragWidth === null && 'maximized', dragWidth !== null && 'resizing')}
      style={!maximized || dragWidth !== null ? { width: shownWidth ?? undefined } : undefined}
      data-path={active}
      onKeyDown={onKeyDown}
    >
      <div className="editor-resize left" title={t('editor.resize')} onPointerDown={startResize(-1)} />
      <div className="editor-resize right" title={t('editor.resize')} onPointerDown={startResize(1)} />
      <header
        className="editor-window-header"
        style={{ borderTopColor: colorForFile(active) }}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) toggleMaximized()
        }}
      >
        <span className="editor-window-name">
          {baseName(active)}
          {dirty && <span className="editor-window-dirty" title={t('editor.unsaved')}> ●</span>}
        </span>
        <span className="editor-window-dir" title={active}>
          {parentOf(active)}
        </span>
        <span className="editor-zoom">
          <button onClick={() => zoomFont('editor', -1)} title={t('editor.zoomOut')}>
            A−
          </button>
          <button className="editor-zoom-value" onClick={() => resetFont('editor')} title={t('editor.zoomReset')}>
            {fontPercent}%
          </button>
          <button onClick={() => zoomFont('editor', 1)} title={t('editor.zoomIn')}>
            A+
          </button>
        </span>
        <button onClick={() => window.api.revealPath(active).catch(reportError)} title={t('editor.revealTitle')}>
          {t('editor.reveal')}
        </button>
        <button
          className="editor-window-icon"
          onClick={toggleMaximized}
          title={maximized ? t('editor.restore') : t('editor.maximize')}
        >
          {maximized ? '⤡' : '⤢'}
        </button>
        <button className="editor-window-icon" onClick={minimize} title={t('editor.minimize')}>
          —
        </button>
        <button className="editor-window-icon" onClick={() => void close(active)} title={t('editor.close')}>
          ×
        </button>
      </header>
      <div className="editor-body">
        <CodeEditor path={doc?.kind === 'text' ? active : null} />
        {doc && doc.kind !== 'text' && <NotEditable path={active} doc={doc} />}
      </div>
    </div>
  )
}

function NotEditable({ path, doc }: { path: string; doc: Exclude<Document, { kind: 'text' }> }) {
  useT()
  const openWithSystem = async (): Promise<void> => {
    try {
      const failure = await window.api.openPath(path)
      if (failure) useProjectStore.getState().setError(t('editor.openFailed', { path, message: failure }))
    } catch (err) {
      reportError(err)
    }
  }

  return (
    <div className="editor-message">
      <p>
        {doc.kind === 'binary' && t('editor.binary', { size: formatSize(doc.size) })}
        {doc.kind === 'too-large' && t('editor.tooLarge', { size: formatSize(doc.size) })}
        {doc.kind === 'error' && t('editor.openError', { message: doc.message })}
      </p>
      {doc.kind !== 'error' && <button onClick={openWithSystem}>{t('editor.openWithSystem')}</button>}
    </div>
  )
}
