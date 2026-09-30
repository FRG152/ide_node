import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  getViewportForBounds,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
  type Viewport
} from '@xyflow/react'
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { buildGraph, NODE_HEIGHT, NODE_WIDTH, nodeIdFor, type GraphNode } from './buildGraph'
import { nodeTypes } from './nodes'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 1.5
const FOCUS_DURATION_MS = 400

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
  node.type === 'folder' ? '#c5a15a' : node.type === 'more' ? '#555' : '#4a7ab8'

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

  const { getZoom, getViewport, setViewport, getInternalNode } = useReactFlow()
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
  // que se sincroniza un render más tarde). El tamaño del lienzo se mide en el DOM:
  // si en este mismo render se abrió el editor o la terminal, React Flow aún no lo
  // sabe (se entera por un ResizeObserver), así que calculamos el viewport nosotros.
  useEffect(() => {
    if (!viewRequest || viewRequest.kind === 'keep' || viewRequest.id === handledRequest.current) return
    handledRequest.current = viewRequest.id

    const width = containerRef.current?.clientWidth ?? 0
    const height = containerRef.current?.clientHeight ?? 0
    if (width === 0 || height === 0) return

    if (viewRequest.kind === 'fit') {
      void setViewport(getViewportForBounds(graph.bounds, width, height, MIN_ZOOM, MAX_ZOOM, 0.1), { duration: 300 })
      return
    }

    const target = graph.nodes.find((n) => n.id === nodeIdFor(viewRequest.path))
    if (!target) return
    const { x, y } = target.position
    if (viewRequest.ifHidden) {
      // Si la cámara se está moviendo, lo que cuenta es dónde va a acabar.
      const moving = cameraTarget.current && performance.now() < cameraTarget.current.until
      const vp = moving ? cameraTarget.current!.viewport : getViewport()
      const left = x * vp.zoom + vp.x
      const top = y * vp.zoom + vp.y
      const onScreen =
        left >= 0 && top >= 0 && left + NODE_WIDTH * vp.zoom <= width && top + NODE_HEIGHT * vp.zoom <= height
      if (onScreen) return
    }
    const zoom = viewRequest.ifHidden ? getZoom() : Math.max(getZoom(), 1)
    const viewport = { x: width / 2 - (x + NODE_WIDTH / 2) * zoom, y: height / 2 - (y + NODE_HEIGHT / 2) * zoom, zoom }
    cameraTarget.current = { viewport, until: performance.now() + FOCUS_DURATION_MS }
    void setViewport(viewport, { duration: FOCUS_DURATION_MS })
  }, [viewRequest, graph, getViewport, setViewport, getZoom])

  return (
    <div ref={containerRef} className="graph-container">
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
        onlyRenderVisibleElements
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={minimapColor} pannable zoomable />
      </ReactFlow>
    </div>
  )
}
