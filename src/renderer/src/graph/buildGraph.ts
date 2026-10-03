import type { Edge, Node, Rect } from '@xyflow/react'
import type { FsEntry } from '../../../shared/ipc'
import { MAX_VISIBLE_CHILDREN } from '../stores/projectStore'

export const NODE_WIDTH = 220
export const NODE_HEIGHT = 32
const COLUMN_GAP = 70
const ROW_GAP = 8
const COLUMN_PITCH = NODE_WIDTH + COLUMN_GAP
const ROW_PITCH = NODE_HEIGHT + ROW_GAP

/** Hermanos seguidos sin subárbol a la vista a partir de los cuales se reparten en una cuadrícula. */
const GRID_MIN_ITEMS = 13
/** Entre columnas de una cuadrícula no hay aristas: van más juntas que las de profundidad. */
const GRID_GAP = 16
const GRID_PITCH = NODE_WIDTH + GRID_GAP
/** Margen del panel que agrupa una cuadrícula. */
const GRID_PADDING = 8
/** Proporción de pantalla para la que se calcula la forma de la cuadrícula (ancho / alto). */
const SCREEN_ASPECT = 1.6

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
export type GridData = Record<string, never>

export type FolderFlowNode = Node<FolderData, 'folder'>
export type FileFlowNode = Node<FileData, 'file'>
export type MoreFlowNode = Node<MoreData, 'more'>
/** Panel de fondo de una cuadrícula de hermanos (decorativo, no se puede clicar). */
export type GridFlowNode = Node<GridData, 'grid'>
export type GraphNode = FolderFlowNode | FileFlowNode | MoreFlowNode | GridFlowNode

export interface TreeInput {
  entries: Record<string, FsEntry>
  children: Record<string, string[]>
  expanded: Record<string, true>
  showAll: Record<string, true>
}

/** Vecinos en la misma fila de una cuadrícula (para ← / → en el modo teclado). */
export interface GridNeighbors {
  left: string | null
  right: string | null
}

export interface ProjectGraphData {
  nodes: GraphNode[]
  edges: Edge[]
  bounds: Rect
  /** Por ruta, solo para los nodos que están dentro de una cuadrícula. */
  gridNeighbors: Record<string, GridNeighbors>
}

export const nodeIdFor = (path: string): string => `f:${path}`
const moreIdFor = (parent: string): string => `m:${parent}`

/** Un hueco de la lista de hijos: una entrada del disco o el nodo "+N más". */
type Item = { kind: 'entry'; path: string } | { kind: 'more'; parent: string; hidden: number }

/**
 * Filas de la cuadrícula para `count` elementos: que en pantalla quede más o menos con la
 * forma del lienzo en vez de una torre altísima (59 hermanos -> 4 columnas de 15).
 */
function gridRows(count: number): number {
  const rows = Math.ceil(Math.sqrt((count * GRID_PITCH) / (ROW_PITCH * SCREEN_ASPECT)))
  const columns = Math.ceil(count / rows)
  return Math.ceil(count / columns)
}

/**
 * Convierte el árbol visible (carpetas expandidas) en nodos y aristas de React Flow.
 *
 * Layout de árbol horizontal: cada nivel de profundidad es una columna, las filas se
 * apilan hacia abajo en orden y cada carpeta se centra respecto a sus hijos. Las rachas
 * largas de hermanos sin subárbol (archivos, carpetas cerradas) se reparten en una
 * cuadrícula por columnas, en orden alfabético de arriba abajo; las carpetas abiertas
 * cortan la racha y llevan su subárbol a la derecha, como siempre.
 */
export function buildGraph({ entries, children, expanded, showAll }: TreeInput): ProjectGraphData {
  const nodes: GraphNode[] = []
  const edges: Edge[] = []
  const gridNeighbors: Record<string, GridNeighbors> = {}
  let nextRowY = 0

  /** Reserva `count` filas y devuelve la y de la primera. */
  const takeRows = (count: number): number => {
    const y = nextRowY
    nextRowY += count * ROW_PITCH
    return y
  }

  const link = (source: string, target: string): void => {
    edges.push({ id: `${source}->${target}`, source, target, type: 'smoothstep' })
  }

  const hasSubtree = (path: string): boolean =>
    entries[path].kind === 'directory' && expanded[path] === true && (children[path]?.length ?? 0) > 0

  const folderNode = (path: string, x: number, y: number): FolderFlowNode => {
    const entry = entries[path]
    const kids = children[path]
    return {
      id: nodeIdFor(path),
      type: 'folder',
      position: { x, y },
      data: {
        path,
        name: entry.name,
        expanded: expanded[path] === true && kids !== undefined,
        childCount: kids?.length ?? null,
        heavy: entry.heavy === true,
        isRoot: path === ''
      }
    }
  }

  /** Nodo de una sola fila (archivo, carpeta sin subárbol a la vista o "+N más"); devuelve su id. */
  const placeRow = (item: Item, x: number, y: number): string => {
    if (item.kind === 'more') {
      const id = moreIdFor(item.parent)
      nodes.push({ id, type: 'more', position: { x, y }, data: { parent: item.parent, hidden: item.hidden } })
      return id
    }
    const entry = entries[item.path]
    if (entry.kind === 'file') {
      nodes.push({ id: nodeIdFor(item.path), type: 'file', position: { x, y }, data: { path: item.path, name: entry.name } })
    } else {
      nodes.push(folderNode(item.path, x, y))
    }
    return nodeIdFor(item.path)
  }

  /** Coloca una racha de hermanos sin subárbol y devuelve las y de los que se unen a la carpeta. */
  const placeRun = (run: Item[], parentId: string, x: number): number[] => {
    if (run.length < GRID_MIN_ITEMS) {
      return run.map((item) => {
        const y = takeRows(1)
        link(parentId, placeRow(item, x, y))
        return y
      })
    }

    const rows = gridRows(run.length)
    const columns = Math.ceil(run.length / rows)
    const top = takeRows(rows)
    nodes.push({
      id: `g:${parentId}:${top}`,
      type: 'grid',
      position: { x: x - GRID_PADDING, y: top - GRID_PADDING },
      width: (columns - 1) * GRID_PITCH + NODE_WIDTH + 2 * GRID_PADDING,
      height: (rows - 1) * ROW_PITCH + NODE_HEIGHT + 2 * GRID_PADDING,
      data: {},
      selectable: false,
      draggable: false,
      focusable: false,
      zIndex: -1
    })

    const ys: number[] = []
    const pathAt = (i: number): string | null => {
      const item = run[i]
      return item?.kind === 'entry' ? item.path : null
    }
    run.forEach((item, i) => {
      const column = Math.floor(i / rows)
      const y = top + (i % rows) * ROW_PITCH
      const id = placeRow(item, x + column * GRID_PITCH, y)
      if (item.kind === 'entry') {
        gridNeighbors[item.path] = { left: column > 0 ? pathAt(i - rows) : null, right: pathAt(i + rows) }
      }
      // Solo la primera columna se une a la carpeta: el resto se lee como parte del bloque.
      if (column === 0) {
        link(parentId, id)
        ys.push(y)
      }
    })
    return ys
  }

  /** Carpeta con su subárbol a la vista; devuelve su y (centrada respecto a sus hijos). */
  const visitFolder = (path: string, depth: number): number => {
    const x = depth * COLUMN_PITCH
    const node = folderNode(path, x, 0)
    nodes.push(node)

    const kids = children[path]
    const visible = showAll[path] ? kids : kids.slice(0, MAX_VISIBLE_CHILDREN)
    const items: Item[] = visible.map((child) => ({ kind: 'entry', path: child }))
    if (kids.length > visible.length) items.push({ kind: 'more', parent: path, hidden: kids.length - visible.length })

    const childX = x + COLUMN_PITCH
    const childYs: number[] = []
    let run: Item[] = []
    for (const item of items) {
      if (item.kind === 'entry' && hasSubtree(item.path)) {
        childYs.push(...placeRun(run, node.id, childX))
        run = []
        link(node.id, nodeIdFor(item.path))
        childYs.push(visitFolder(item.path, depth + 1))
      } else {
        run.push(item)
      }
    }
    childYs.push(...placeRun(run, node.id, childX))

    node.position.y = (childYs[0] + childYs[childYs.length - 1]) / 2
    return node.position.y
  }

  if (entries['']) {
    if (hasSubtree('')) visitFolder('', 0)
    else placeRow({ kind: 'entry', path: '' }, 0, takeRows(1))
  }

  let right = NODE_WIDTH
  for (const n of nodes) {
    n.width ??= NODE_WIDTH
    n.height ??= NODE_HEIGHT
    right = Math.max(right, n.position.x + n.width)
  }

  return {
    nodes,
    edges,
    bounds: { x: 0, y: 0, width: right, height: Math.max(nextRowY - ROW_GAP, NODE_HEIGHT) },
    gridNeighbors
  }
}
