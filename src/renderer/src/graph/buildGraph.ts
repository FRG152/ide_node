import type { Edge, Node, Rect } from '@xyflow/react'
import type { FsEntry } from '../../../shared/ipc'
import { MAX_VISIBLE_CHILDREN } from '../store'

export const NODE_WIDTH = 220
export const NODE_HEIGHT = 32
const COLUMN_GAP = 70
const ROW_GAP = 8

export type FolderData = {
  path: string
  name: string
  expanded: boolean
  /** null si la carpeta aún no se ha listado. */
  childCount: number | null
  heavy: boolean
  isRoot: boolean
}
export type FileData = { path: string; name: string }
export type MoreData = { parent: string; hidden: number }

export type FolderFlowNode = Node<FolderData, 'folder'>
export type FileFlowNode = Node<FileData, 'file'>
export type MoreFlowNode = Node<MoreData, 'more'>
export type GraphNode = FolderFlowNode | FileFlowNode | MoreFlowNode

export interface TreeInput {
  entries: Record<string, FsEntry>
  children: Record<string, string[]>
  expanded: Record<string, true>
  showAll: Record<string, true>
}

export interface ProjectGraphData {
  nodes: GraphNode[]
  edges: Edge[]
  bounds: Rect
}

export const nodeIdFor = (path: string): string => `f:${path}`
const moreIdFor = (parent: string): string => `m:${parent}`

/**
 * Convierte el árbol visible (carpetas expandidas) en nodos y aristas de React Flow.
 *
 * Layout de árbol horizontal: cada nivel de profundidad es una columna, las hojas
 * se apilan hacia abajo en orden y cada carpeta se centra respecto a sus hijos.
 */
export function buildGraph({ entries, children, expanded, showAll }: TreeInput): ProjectGraphData {
  const nodes: GraphNode[] = []
  const edges: Edge[] = []
  let nextLeafY = 0

  const takeRow = (): number => {
    const y = nextLeafY
    nextLeafY += NODE_HEIGHT + ROW_GAP
    return y
  }

  const link = (source: string, target: string): void => {
    edges.push({ id: `${source}->${target}`, source, target, type: 'smoothstep' })
  }

  /** Añade el nodo (y su subárbol visible) y devuelve su coordenada y. */
  const visit = (path: string, depth: number): number => {
    const entry = entries[path]
    const id = nodeIdFor(path)
    const x = depth * (NODE_WIDTH + COLUMN_GAP)

    if (entry.kind === 'file') {
      const y = takeRow()
      nodes.push({ id, type: 'file', position: { x, y }, data: { path, name: entry.name } })
      return y
    }

    const kids = children[path]
    const isExpanded = expanded[path] === true && kids !== undefined
    const node: FolderFlowNode = {
      id,
      type: 'folder',
      position: { x, y: 0 },
      data: {
        path,
        name: entry.name,
        expanded: isExpanded,
        childCount: kids?.length ?? null,
        heavy: entry.heavy === true,
        isRoot: path === ''
      }
    }
    nodes.push(node)

    if (!isExpanded || kids.length === 0) {
      node.position.y = takeRow()
      return node.position.y
    }

    const visible = showAll[path] ? kids : kids.slice(0, MAX_VISIBLE_CHILDREN)
    const childYs = visible.map((child) => {
      link(id, nodeIdFor(child))
      return visit(child, depth + 1)
    })

    const hidden = kids.length - visible.length
    if (hidden > 0) {
      const moreId = moreIdFor(path)
      const y = takeRow()
      nodes.push({
        id: moreId,
        type: 'more',
        position: { x: x + NODE_WIDTH + COLUMN_GAP, y },
        data: { parent: path, hidden }
      })
      link(id, moreId)
      childYs.push(y)
    }

    node.position.y = (childYs[0] + childYs[childYs.length - 1]) / 2
    return node.position.y
  }

  if (entries['']) visit('', 0)

  let maxX = 0
  for (const n of nodes) {
    n.width = NODE_WIDTH
    n.height = NODE_HEIGHT
    maxX = Math.max(maxX, n.position.x)
  }

  return {
    nodes,
    edges,
    bounds: { x: 0, y: 0, width: maxX + NODE_WIDTH, height: Math.max(nextLeafY - ROW_GAP, NODE_HEIGHT) }
  }
}
