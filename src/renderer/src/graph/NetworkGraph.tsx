import { useEffect, useRef, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useT } from '../i18n'
import { useClaudeStore } from '../stores/claudeStore'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { activateNode } from './activate'
import { createNetwork, visibleTree, type Network } from './network'
import type { GraphViewControl } from './viewControl'

interface Props {
  control: RefObject<GraphViewControl | null>
  /** En modo teclado el nodo seleccionado se marca más: es el cursor. */
  keyboardMode: boolean
}

/**
 * Vista de red (estilo Obsidian): el mismo árbol visible que la vista de árbol, pero como
 * nodos sueltos que se ordenan solos. El dibujo y la simulación están en network.ts; este
 * componente solo le pasa el estado de los stores.
 */
export function NetworkGraph({ control, keyboardMode }: Props) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const network = useRef<Network | null>(null)
  const tree = useProjectStore(
    useShallow((s) => ({ entries: s.entries, children: s.children, expanded: s.expanded, showAll: s.showAll }))
  )
  const viewRequest = useProjectStore((s) => s.viewRequest)

  useEffect(() => {
    const created = createNetwork(canvasRef.current!, (item) => activateNode(item.kind, item.path))
    network.current = created
    control.current = { zoomBy: created.zoomBy, gridNeighbors: {}, spatial: created.spatial }
    // La selección, lo que toca Claude y los cambios sin guardar se leen al dibujar.
    const unsubscribe = [
      useProjectStore.subscribe(created.redraw),
      useClaudeStore.subscribe(created.redraw),
      useEditorStore.subscribe(created.redraw)
    ]
    return () => {
      for (const stop of unsubscribe) stop()
      created.destroy()
      network.current = null
      control.current = null
    }
  }, [control])

  useEffect(() => {
    network.current?.setTree(visibleTree(tree))
  }, [tree])

  // Después del efecto anterior: el nodo pedido puede acabar de aparecer. Si aún no está,
  // la petición se reintenta con el siguiente cambio del árbol.
  useEffect(() => {
    if (viewRequest) network.current?.handleRequest(viewRequest)
  }, [viewRequest, tree])

  useEffect(() => {
    network.current?.setKeyboardMode(keyboardMode)
  }, [keyboardMode])

  return (
    <>
      <canvas ref={canvasRef} className="network-canvas" />
      <div className="graph-controls">
        <button onClick={() => network.current?.zoomBy(1.25)} title={t('graph.zoomIn')}>
          +
        </button>
        <button onClick={() => network.current?.zoomBy(0.8)} title={t('graph.zoomOut')}>
          −
        </button>
        <button onClick={() => network.current?.fit()} title={t('graph.fit')}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
          </svg>
        </button>
      </div>
    </>
  )
}
