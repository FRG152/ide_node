import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type NodeMouseHandler
} from '@xyflow/react'
import { useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore } from '../store'
import { buildGraph, NODE_HEIGHT, NODE_WIDTH, nodeIdFor, type GraphNode } from './buildGraph'
import { nodeTypes } from './nodes'

const onNodeClick: NodeMouseHandler<GraphNode> = (_event, node) => {
  const { toggleFolder, selectFile, showAllChildren } = useProjectStore.getState()
  switch (node.type) {
    case 'folder':
      void toggleFolder(node.data.path)
      break
    case 'file':
      selectFile(node.data.path)
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

  const { fitBounds, setCenter, getZoom, getViewport, setViewport, getInternalNode } = useReactFlow()
  const handledRequest = useRef(0)

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
  // que se sincroniza un render más tarde).
  useEffect(() => {
    if (!viewRequest || viewRequest.kind === 'keep' || viewRequest.id === handledRequest.current) return

    const move = (): void => {
      handledRequest.current = viewRequest.id
      if (viewRequest.kind === 'fit') {
        void fitBounds(graph.bounds, { padding: 0.1, duration: 300 })
        return
      }
      const target = graph.nodes.find((n) => n.id === nodeIdFor(viewRequest.path))
      if (target) {
        void setCenter(target.position.x + NODE_WIDTH / 2, target.position.y + NODE_HEIGHT / 2, {
          zoom: Math.max(getZoom(), 1),
          duration: 400
        })
      }
    }

    // Si en este mismo render se abrió/cerró el panel de vista previa, el lienzo cambia
    // de tamaño y React Flow no lo sabe hasta su ResizeObserver: esperamos dos frames
    // para centrar con las dimensiones ya actualizadas.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(move)
    })
    return () => cancelAnimationFrame(frame)
  }, [viewRequest, graph, fitBounds, setCenter, getZoom])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      colorMode="dark"
      minZoom={0.05}
      maxZoom={1.5}
      nodesConnectable={false}
      elementsSelectable={false}
      onlyRenderVisibleElements
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <MiniMap nodeColor={minimapColor} pannable zoomable />
    </ReactFlow>
  )
}
