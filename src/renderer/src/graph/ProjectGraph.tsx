import { ReactFlowProvider } from '@xyflow/react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useT } from '../i18n'
import { classes } from '../lib/classes'
import { useGraphViewStore } from '../stores/graphViewStore'
import { useProjectStore } from '../stores/projectStore'
import { Breadcrumbs } from './Breadcrumbs'
import { FOCUS_GRAPH_EVENT, handleGraphKey } from './keyboard'
import { NetworkGraph } from './NetworkGraph'
import { TreeGraph } from './TreeGraph'
import type { GraphViewControl } from './viewControl'

/**
 * Panel del grafo: la vista elegida (árbol o red) y lo que ambas comparten: el foco, el modo
 * teclado, la barra de teclas y las migas de pan.
 */
export function ProjectGraph() {
  const t = useT()
  const view = useGraphViewStore((s) => s.view)
  const rootPath = useProjectStore((s) => s.project?.rootPath)
  /** Modo teclado: el grafo tiene el foco y se navega con las flechas (se ve la barra de teclas). */
  const [keyboardMode, setKeyboardMode] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const control = useRef<GraphViewControl | null>(null)

  // Ctrl+Shift+E, el botón ⌨ o Esc desde el editor: foco al grafo y modo teclado.
  useEffect(() => {
    const enter = (): void => {
      containerRef.current?.focus({ preventScroll: true })
      setKeyboardMode(true)
      const { selected, focus } = useProjectStore.getState()
      focus(selected ?? '', { quick: true })
    }
    window.addEventListener(FOCUS_GRAPH_EVENT, enter)
    return () => window.removeEventListener(FOCUS_GRAPH_EVENT, enter)
  }, [])

  // Al cambiar de vista la cámara empieza de cero: la llevamos a lo seleccionado (o a todo).
  const shownView = useRef(view)
  useEffect(() => {
    if (shownView.current === view) return
    shownView.current = view
    const { selected, focus, fit } = useProjectStore.getState()
    if (selected === null) fit()
    else focus(selected)
  }, [view])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    let handled = true
    if (e.key === 'Escape') {
      if (!keyboardMode) return
      setKeyboardMode(false)
      containerRef.current?.blur()
      e.preventDefault()
      return
    } else if (e.key === '+' || e.key === '=') {
      control.current?.zoomBy(1.2)
    } else if (e.key === '-') {
      control.current?.zoomBy(1 / 1.2)
    } else {
      handled = handleGraphKey(e.key, control.current)
    }
    if (handled) {
      e.preventDefault()
      setKeyboardMode(true)
    }
  }

  return (
    <div
      ref={containerRef}
      className={classes('graph-container', keyboardMode && 'keyboard')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      // React Flow cancela el mousedown (para arrastrar el lienzo) y el foco no llegaría aquí:
      // lo damos a mano para que, tras un clic, las flechas funcionen.
      onPointerDownCapture={() => {
        containerRef.current?.focus({ preventScroll: true })
        setKeyboardMode(false)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardMode(false)
      }}
    >
      {view === 'tree' ? (
        <ReactFlowProvider key={rootPath}>
          <TreeGraph container={containerRef} control={control} />
        </ReactFlowProvider>
      ) : (
        <NetworkGraph key={rootPath} control={control} keyboardMode={keyboardMode} />
      )}
      <Breadcrumbs />
      {keyboardMode && (
        <div className="keyboard-hint">
          <span className="keyboard-hint-title">⌨ {t('keys.title')}</span>
          {view === 'tree' ? (
            <>
              <span><kbd>↑</kbd><kbd>↓</kbd> {t('keys.move')}</span>
              <span><kbd>←</kbd> {t('keys.left')}</span>
              <span><kbd>→</kbd> {t('keys.right')}</span>
            </>
          ) : (
            <span><kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> {t('keys.nearest')}</span>
          )}
          <span><kbd>Enter</kbd> {t('keys.open')}</span>
          <span><kbd>Home</kbd> {t('keys.root')}</span>
          <span><kbd>+</kbd><kbd>−</kbd> {t('keys.zoom')}</span>
          <span><kbd>Ctrl</kbd><kbd>Tab</kbd> {t('keys.cycle')}</span>
          <span><kbd>Esc</kbd> {t('keys.exit')}</span>
        </div>
      )}
    </div>
  )
}
