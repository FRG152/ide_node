import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  getViewportForBounds,
  useReactFlow,
  useStore,
  type Edge,
  type NodeMouseHandler,
  type Rect,
  type Viewport
} from '@xyflow/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore, type ViewRequest } from '../stores/projectStore'
import { buildGraph, NODE_HEIGHT, NODE_WIDTH, nodeIdFor, type GraphNode, type ProjectGraphData } from './buildGraph'
import { useT } from '../i18n'
import { classes } from '../lib/classes'
import { Breadcrumbs } from './Breadcrumbs'
import { FOCUS_GRAPH_EVENT, handleGraphKey } from './keyboard'
import { nodeTypes } from './nodes'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 1.5
/** Encuadrar no acerca más que esto: con pocos nodos, a 1.5 se ve muy poco alrededor. */
const FIT_MAX_ZOOM = 1
const FIT_PADDING = 0.1
/**
 * Zoom semántico: por debajo de esto el texto de los archivos ya no se lee. Se pintan como
 * barras de su color y solo se rotulan las carpetas, con letra que no encoge (ver styles.css).
 */
const FAR_ZOOM = 0.6
/** Al abrir una carpeta, la cámara aleja hasta aquí como mucho para que quepa su contenido. */
const READABLE_ZOOM = 0.7
/** Margen (px de pantalla) al encuadrar una carpeta con su contenido. */
const FRAME_MARGIN = 40
const FOCUS_DURATION_MS = 400
/** Al navegar con el teclado la cámara sigue a la selección con una animación corta. */
const QUICK_FOCUS_DURATION_MS = 180
/** Ventana tras un movimiento de cámara en la que un cambio de tamaño del lienzo lo repite. */
const REAPPLY_AFTER_RESIZE_MS = 600

type CameraRequest = Exclude<ViewRequest, { kind: 'keep' }>

/** Caja de una carpeta y sus hijos directos (incluidas sus cuadrículas), en coordenadas del grafo. */
function contentBox(graph: ProjectGraphData, folderId: string): Rect {
  const ids = new Set([folderId])
  for (const edge of graph.edges) if (edge.source === folderId) ids.add(edge.target)
  const gridPrefix = `g:${folderId}:`
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const n of graph.nodes) {
    if (!ids.has(n.id) && !n.id.startsWith(gridPrefix)) continue
    left = Math.min(left, n.position.x)
    top = Math.min(top, n.position.y)
    right = Math.max(right, n.position.x + (n.width ?? NODE_WIDTH))
    bottom = Math.max(bottom, n.position.y + (n.height ?? NODE_HEIGHT))
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

const onNodeClick: NodeMouseHandler<GraphNode> = (_event, node) => {
  const { toggleFolder, select, showAllChildren } = useProjectStore.getState()
  switch (node.type) {
    case 'folder':
      void toggleFolder(node.data.path)
      break
    case 'file':
      select(node.data.path)
      void useEditorStore.getState().open(node.data.path, 'center')
      break
    case 'more':
      showAllChildren(node.data.parent)
      break
  }
}

const minimapColor = (node: GraphNode): string =>
  node.type === 'folder' ? '#d77757' : node.type === 'more' ? '#3d3d3a' : node.type === 'grid' ? 'transparent' : '#6b6a65'

/**
 * Publica el zoom en el contenedor (variable --zoom y data-zoom="far"/"near") para que el CSS
 * cambie el nivel de detalle sin volver a renderizar los nodos.
 */
function ZoomLevel({ container }: { container: RefObject<HTMLDivElement | null> }) {
  const zoom = useStore((s) => s.transform[2])
  useLayoutEffect(() => {
    const el = container.current
    if (!el) return
    el.style.setProperty('--zoom', String(zoom))
    el.dataset.zoom = zoom < FAR_ZOOM ? 'far' : 'near'
  }, [zoom, container])
  return null
}

export function ProjectGraph() {
  const { entries, children, expanded, showAll, viewRequest } = useProjectStore(
    useShallow((s) => ({
      entries: s.entries,
      children: s.children,
      expanded: s.expanded,
      showAll: s.showAll,
      viewRequest: s.viewRequest
    }))
  )

  const graph = useMemo(
    () => buildGraph({ entries, children, expanded, showAll }),
    [entries, children, expanded, showAll]
  )

  const t = useT()
  const { getViewport, setViewport, getInternalNode, zoomIn, zoomOut } = useReactFlow()
  /** Modo teclado: el grafo tiene el foco y se navega con las flechas (se ve la barra de teclas). */
  const [keyboardMode, setKeyboardMode] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const handledRequest = useRef(0)
  /** Destino de la última animación de cámara, mientras dura. */
  const cameraTarget = useRef<{ viewport: Viewport; until: number } | null>(null)

  // Estado local para que los nodos se puedan arrastrar. Cada cambio de estructura
  // recalcula el layout y descarta las posiciones movidas a mano.
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>(graph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(graph.edges)
  useEffect(() => {
    // Al expandir/colapsar, el layout se recoloca entero. Desplazamos la cámara lo mismo
    // que se movió la carpeta clicada para que siga bajo el cursor. React Flow aún tiene
    // aquí las posiciones anteriores, y ambos cambios se pintan en el mismo render.
    const request = useProjectStore.getState().viewRequest
    if (request?.kind === 'keep' && request.id !== handledRequest.current) {
      handledRequest.current = request.id
      const id = nodeIdFor(request.path)
      const before = getInternalNode(id)?.position
      const after = graph.nodes.find((n) => n.id === id)?.position
      if (before && after) {
        const { x, y, zoom } = getViewport()
        void setViewport({ x: x - (after.x - before.x) * zoom, y: y - (after.y - before.y) * zoom, zoom })
      }
    }
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges, getInternalNode, getViewport, setViewport])

  // fit/focus usan las posiciones del layout recién calculado (no el estado local,
  // que se sincroniza un render más tarde) y el tamaño del lienzo medido en el DOM.
  const applyCamera = useCallback(
    (request: CameraRequest, graph: ProjectGraphData): void => {
      const width = containerRef.current?.clientWidth ?? 0
      const height = containerRef.current?.clientHeight ?? 0
      if (width === 0 || height === 0) return

      if (request.kind === 'fit') {
        void setViewport(getViewportForBounds(graph.bounds, width, height, MIN_ZOOM, FIT_MAX_ZOOM, FIT_PADDING), {
          duration: 300
        })
        return
      }

      const target = graph.nodes.find((n) => n.id === nodeIdFor(request.path))
      if (!target) return
      const { x, y } = target.position
      // Si la cámara se está moviendo, lo que cuenta es dónde va a acabar.
      const moving = cameraTarget.current !== null && performance.now() < cameraTarget.current.until
      const current = moving ? cameraTarget.current!.viewport : getViewport()

      if (request.ifHidden) {
        const left = x * current.zoom + current.x
        const top = y * current.zoom + current.y
        const onScreen =
          left >= 0 &&
          top >= 0 &&
          left + NODE_WIDTH * current.zoom <= width &&
          top + NODE_HEIGHT * current.zoom <= height
        if (onScreen) return
      }
      let zoom = request.ifHidden ? current.zoom : Math.max(current.zoom, 1)
      let centerX = x + NODE_WIDTH / 2
      let centerY = y + NODE_HEIGHT / 2
      if (request.withChildren) {
        // Carpeta recién abierta: que se vea con su contenido (alejando si hace falta, sin
        // pasar de READABLE_ZOOM). Si no cabe a lo ancho, la carpeta queda a la izquierda y
        // su contenido a la derecha hasta donde llegue; si no cabe a lo alto, centrada en vertical.
        const box = contentBox(graph, target.id)
        const roomX = width - 2 * FRAME_MARGIN
        const roomY = height - 2 * FRAME_MARGIN
        zoom = Math.min(zoom, Math.max(Math.min(roomX / box.width, roomY / box.height), READABLE_ZOOM))
        centerX = box.width * zoom <= roomX ? box.x + box.width / 2 : box.x + (width / 2 - FRAME_MARGIN) / zoom
        if (box.height * zoom <= roomY) centerY = box.y + box.height / 2
      }
      const viewport = { x: width / 2 - centerX * zoom, y: height / 2 - centerY * zoom, zoom }
      const duration = request.quick ? QUICK_FOCUS_DURATION_MS : FOCUS_DURATION_MS
      cameraTarget.current = { viewport, until: performance.now() + duration }
      void setViewport(viewport, { duration })
    },
    [getViewport, setViewport]
  )

  /** Último movimiento de cámara, por si hay que repetirlo tras un cambio de tamaño. */
  const lastCamera = useRef<{ request: CameraRequest; graph: ProjectGraphData; at: number } | null>(null)

  useEffect(() => {
    if (!viewRequest || viewRequest.kind === 'keep' || viewRequest.id === handledRequest.current) return
    handledRequest.current = viewRequest.id
    lastCamera.current = { request: viewRequest, graph, at: performance.now() }
    applyCamera(viewRequest, graph)
  }, [viewRequest, graph, applyCamera])

  // Si el editor se abre en el mismo render que la petición de cámara, el grupo de paneles
  // recoloca los tamaños justo después de este efecto: el lienzo encoge y el nodo quedaría
  // descentrado. Si el tamaño cambia poco después de mover la cámara, repetimos el movimiento.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let size = { width: el.clientWidth, height: el.clientHeight }
    const observer = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight }
      if (next.width === size.width && next.height === size.height) return
      size = next
      const last = lastCamera.current
      if (last && performance.now() - last.at < REAPPLY_AFTER_RESIZE_MS) applyCamera(last.request, last.graph)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [applyCamera])

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
      void zoomIn({ duration: 150 })
    } else if (e.key === '-') {
      void zoomOut({ duration: 150 })
    } else {
      handled = handleGraphKey(e.key, graph.gridNeighbors)
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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        colorMode="dark"
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        nodesConnectable={false}
        elementsSelectable={false}
        // Las flechas son nuestras (modo teclado), no del teclado accesible de React Flow.
        nodesFocusable={false}
        edgesFocusable={false}
        disableKeyboardA11y
        deleteKeyCode={null}
        onlyRenderVisibleElements
      >
        <Background gap={24} />
        <Controls showInteractive={false} fitViewOptions={{ maxZoom: FIT_MAX_ZOOM, padding: FIT_PADDING }} />
        <MiniMap nodeColor={minimapColor} pannable zoomable />
        <ZoomLevel container={containerRef} />
      </ReactFlow>
      <Breadcrumbs />
      {keyboardMode && (
        <div className="keyboard-hint">
          <span className="keyboard-hint-title">⌨ {t('keys.title')}</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('keys.move')}</span>
          <span><kbd>←</kbd> {t('keys.left')}</span>
          <span><kbd>→</kbd> {t('keys.right')}</span>
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
