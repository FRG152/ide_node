/**
 * Vista de red, al estilo del grafo de Obsidian: el árbol visible del proyecto como nodos
 * sueltos unidos por muelles (d3-force) y dibujados en un <canvas>.
 *
 * Aquí no hay React: el componente NetworkGraph crea el motor y le pasa los datos. Las
 * posiciones viven en el motor y sobreviven a los cambios del árbol, así que al abrir una
 * carpeta sus hijos brotan de ella y el resto se recoloca sin saltos.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force'
import { useClaudeStore } from '../stores/claudeStore'
import { useEditorStore } from '../stores/editorStore'
import { MAX_VISIBLE_CHILDREN, useProjectStore, type ViewRequest } from '../stores/projectStore'
import { ancestorsOf } from '../lib/paths'
import type { ClaudeFileAccess } from '../../../shared/ipc'
import type { TreeInput } from './buildGraph'
import type { ArrowKey } from './viewControl'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 4
/** Encuadrar no acerca más que esto. */
const FIT_MAX_ZOOM = 1.2
/** Margen (px de pantalla) al encuadrar. */
const FIT_MARGIN = 60
/** Píxeles que tiene que moverse el puntero para que un clic pase a ser un arrastre. */
const DRAG_THRESHOLD = 4
const LABEL_SIZE = 11
/** Celdas (px de pantalla) de la rejilla con la que se busca rápido qué rótulos hay cerca de otro. */
const LABEL_CELL_WIDTH = 64
const LABEL_CELL_HEIGHT = 16
/** Semiángulo del cono en el que las flechas buscan el siguiente nodo (coseno de 60°). */
const ARROW_CONE = 0.5

export interface TreeItem {
  /** La ruta, o un id propio para el nodo "+N más". */
  id: string
  kind: 'folder' | 'file' | 'more'
  /** Para "+N más", la carpeta cuyos hijos faltan por mostrar. */
  path: string
  name: string
  parent: string | null
  expanded: boolean
  heavy: boolean
  /** Hijos de la carpeta (null si aún no se ha listado). */
  count: number | null
}

interface NetNode extends SimulationNodeDatum, TreeItem {
  x: number
  y: number
  r: number
  /** Ancho del rótulo en píxeles de pantalla (no depende del zoom). */
  labelWidth: number
}
type NetLink = SimulationLinkDatum<NetNode> & { source: NetNode; target: NetNode }

/** La cámara sigue a su objetivo (que se mueve mientras la simulación se asienta). */
type Follow = { kind: 'fit' } | { kind: 'node'; id: string; quick: boolean }

export interface Network {
  setTree: (items: TreeItem[]) => void
  /** Aplica una petición de cámara del projectStore. Devuelve false si su nodo aún no existe. */
  handleRequest: (request: ViewRequest) => boolean
  setKeyboardMode: (on: boolean) => void
  zoomBy: (factor: number) => void
  fit: () => void
  /** Nodo más cercano a `path` en la dirección de la flecha, o null. */
  spatial: (path: string, key: ArrowKey) => string | null
  redraw: () => void
  destroy: () => void
}

const moreIdFor = (parent: string): string => `\0more:${parent}`

/** El árbol a la vista (carpetas expandidas), en orden: cada elemento va después de su padre. */
export function visibleTree({ entries, children, expanded, showAll }: TreeInput): TreeItem[] {
  const items: TreeItem[] = []
  const visit = (path: string, parent: string | null): void => {
    const entry = entries[path]
    const kids = children[path]
    const open = entry.kind === 'directory' && expanded[path] === true && kids !== undefined
    items.push({
      id: path,
      kind: entry.kind === 'file' ? 'file' : 'folder',
      path,
      name: entry.name,
      parent,
      expanded: open,
      heavy: entry.heavy === true,
      count: kids?.length ?? null
    })
    if (!open) return
    const visible = showAll[path] ? kids : kids.slice(0, MAX_VISIBLE_CHILDREN)
    for (const kid of visible) visit(kid, path)
    const hidden = kids.length - visible.length
    if (hidden > 0) {
      items.push({ id: moreIdFor(path), kind: 'more', path, name: `+${hidden}`, parent: path, expanded: false, heavy: false, count: null })
    }
  }
  if (entries['']) visit('', null)
  return items
}

/** Las carpetas pesan más cuantos más hijos tienen, como los nodos muy enlazados de Obsidian. */
function radiusOf(item: TreeItem): number {
  if (item.kind !== 'folder') return 4
  return 6 + Math.min(10, Math.sqrt(item.count ?? 0) * 1.3) + (item.id === '' ? 2 : 0)
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const ARROWS: Record<ArrowKey, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0]
}

export function createNetwork(canvas: HTMLCanvasElement, onActivate: (item: TreeItem) => void): Network {
  const ctx = canvas.getContext('2d')!
  const style = getComputedStyle(canvas)
  const color = (name: string): string => style.getPropertyValue(name).trim()
  // La misma paleta que el resto de la app (variables de styles.css).
  const palette = {
    edge: color('--text-secondary'),
    file: color('--text-dim'),
    folder: color('--text'),
    closedFolder: color('--claude'),
    empty: color('--text-subtle'),
    label: color('--text-secondary'),
    labelStrong: color('--text'),
    selected: color('--suggestion'),
    dirty: color('--warning'),
    read: color('--ide'),
    edit: color('--claude')
  }
  const fontFamily = style.fontFamily
  const labelFont = (node: NetNode): string => `${node.kind === 'folder' ? 600 : 400} ${LABEL_SIZE}px ${fontFamily}`

  let nodes = new Map<string, NetNode>()
  let list: NetNode[] = []
  /** Los nodos por importancia (las carpetas grandes primero): el orden en que piden sitio los rótulos. */
  let labelOrder: NetNode[] = []
  let links: NetLink[] = []
  const view = { x: 0, y: 0, k: 1 }
  const size = { width: 0, height: 0 }
  let follow: Follow | null = { kind: 'fit' }
  let hovered: NetNode | null = null
  /** Última posición del puntero sobre el lienzo (null si está fuera o arrastrando). */
  let pointer: { x: number; y: number } | null = null
  /** El nodo bajo el puntero con su padre y sus hijos: lo demás se atenúa. */
  let neighborhood: Set<NetNode> | null = null
  let keyboardMode = false
  let handledRequest = 0
  let frame = 0
  let lastTime = 0
  /** La simulación seguía activa en el fotograma anterior. */
  let settling = false
  let destroyed = false

  const linkForce = forceLink<NetNode, NetLink>()
    .distance((link) => 24 + link.source.r + link.target.r + (link.target.kind === 'folder' ? 28 : 0))
    .strength(0.9)
  // La simulación no usa su propio temporizador: damos un paso por fotograma en `tick`.
  const simulation = forceSimulation<NetNode>()
    .force('link', linkForce)
    .force(
      'charge',
      forceManyBody<NetNode>()
        .strength((node) => (node.kind === 'folder' ? -220 : -60))
        .distanceMax(450)
        .theta(1)
    )
    .force('collide', forceCollide<NetNode>().radius((node) => node.r + 3))
    .force('x', forceX<NetNode>(0).strength(0.03))
    .force('y', forceY<NetNode>(0).strength(0.03))
    .velocityDecay(0.35)
    .stop()

  const invalidate = (): void => {
    if (!frame && !destroyed) frame = requestAnimationFrame(tick)
  }

  /** Reaviva la simulación (al cambiar el árbol o arrastrar un nodo). */
  const heat = (alpha: number): void => {
    if (simulation.alpha() < alpha) simulation.alpha(alpha)
    invalidate()
  }

  // ---- Cámara ----

  function fitTarget(): typeof view | null {
    if (list.length === 0) return null
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const node of list) {
      left = Math.min(left, node.x - node.r)
      top = Math.min(top, node.y - node.r)
      right = Math.max(right, node.x + node.r)
      bottom = Math.max(bottom, node.y + node.r)
    }
    const k = clamp(
      Math.min((size.width - 2 * FIT_MARGIN) / (right - left), (size.height - 2 * FIT_MARGIN) / (bottom - top)),
      MIN_ZOOM,
      FIT_MAX_ZOOM
    )
    return { x: size.width / 2 - ((left + right) / 2) * k, y: size.height / 2 - ((top + bottom) / 2) * k, k }
  }

  function followTarget(): typeof view | null {
    if (!follow || size.width === 0) return null
    if (follow.kind === 'fit') return fitTarget()
    const node = nodes.get(follow.id)
    return node ? { x: size.width / 2 - node.x * view.k, y: size.height / 2 - node.y * view.k, k: view.k } : null
  }

  /** Acerca la cámara a su objetivo. Devuelve true mientras quede movimiento por hacer. */
  function stepCamera(elapsed: number, simulating: boolean): boolean {
    const target = followTarget()
    if (!follow || !target) {
      follow = null
      return false
    }
    const rate = 1 - Math.exp(-elapsed / (follow.kind === 'node' && follow.quick ? 60 : 130))
    view.x += (target.x - view.x) * rate
    view.y += (target.y - view.y) * rate
    view.k += (target.k - view.k) * rate
    const arrived =
      Math.abs(target.x - view.x) < 0.5 && Math.abs(target.y - view.y) < 0.5 && Math.abs(target.k - view.k) < 0.001
    // Mientras la simulación siga moviendo los nodos, el objetivo también se mueve.
    if (arrived && !simulating) follow = null
    return !arrived
  }

  const zoomAt = (factor: number, x: number, y: number): void => {
    const k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM)
    view.x = x - (x - view.x) * (k / view.k)
    view.y = y - (y - view.y) * (k / view.k)
    view.k = k
    follow = null
    invalidate()
  }

  // ---- Dibujo ----

  let touchedSource: Record<string, ClaudeFileAccess> | null = null
  let touchedFolders = new Map<string, ClaudeFileAccess>()
  /** Carpetas con algo tocado por Claude dentro ('edit' gana a 'read'), para marcar las cerradas. */
  function foldersTouched(touched: Record<string, ClaudeFileAccess>): Map<string, ClaudeFileAccess> {
    if (touched === touchedSource) return touchedFolders
    touchedSource = touched
    touchedFolders = new Map()
    for (const [path, access] of Object.entries(touched)) {
      for (const dir of ancestorsOf(path)) {
        if (access === 'edit' || !touchedFolders.has(dir)) touchedFolders.set(dir, access)
      }
    }
    return touchedFolders
  }

  function draw(): void {
    const ratio = window.devicePixelRatio || 1
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    ctx.translate(view.x, view.y)
    ctx.scale(view.k, view.k)

    const k = view.k
    const px = 1 / k // un píxel de pantalla, en unidades del grafo
    const left = -view.x / k
    const top = -view.y / k
    const right = left + size.width / k
    const bottom = top + size.height / k
    const offscreen = (node: NetNode, margin: number): boolean =>
      node.x < left - margin || node.x > right + margin || node.y < top - margin || node.y > bottom + margin

    const { selected } = useProjectStore.getState()
    const { touched } = useClaudeStore.getState()
    const { dirty } = useEditorStore.getState()
    const inFolders = foldersTouched(touched)

    // Aristas
    ctx.lineWidth = px
    ctx.strokeStyle = palette.edge
    ctx.globalAlpha = neighborhood ? 0.1 : 0.32
    ctx.beginPath()
    for (const { source, target } of links) {
      if (offscreen(source, 0) && offscreen(target, 0)) continue
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
    }
    ctx.stroke()
    if (hovered) {
      ctx.lineWidth = 1.5 * px
      ctx.strokeStyle = palette.selected
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      for (const { source, target } of links) {
        if (source !== hovered && target !== hovered) continue
        ctx.moveTo(source.x, source.y)
        ctx.lineTo(target.x, target.y)
      }
      ctx.stroke()
    }

    // Nodos: un solo trazado por color y opacidad. Con miles de círculos, rellenarlos de uno
    // en uno es lo que más tarda.
    const batches = new Map<string, { fill: string; alpha: number; nodes: NetNode[] }>()
    for (const node of list) {
      if (offscreen(node, node.r)) continue
      let fill = palette.file
      if (node.kind === 'file') fill = dirty[node.path] ? palette.dirty : palette.file
      else if (node.kind === 'more' || node.count === 0) fill = palette.empty
      else fill = node.expanded ? palette.folder : palette.closedFolder
      const alpha = (neighborhood && !neighborhood.has(node) ? 0.18 : 1) * (node.heavy ? 0.45 : 1)
      const key = fill + alpha
      let batch = batches.get(key)
      if (!batch) batches.set(key, (batch = { fill, alpha, nodes: [] }))
      batch.nodes.push(node)
    }
    for (const { fill, alpha, nodes } of batches.values()) {
      ctx.globalAlpha = alpha
      ctx.fillStyle = fill
      ctx.beginPath()
      for (const node of nodes) {
        ctx.moveTo(node.x + node.r, node.y)
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2)
      }
      ctx.fill()
    }

    // Anillos: lo que Claude ha leído (azul) o editado (naranja) —en una carpeta cerrada, lo
    // que hay dentro— y el nodo seleccionado.
    const ring = (node: NetNode, gap: number, width: number, stroke: string, glow: boolean): void => {
      ctx.lineWidth = width * px
      ctx.strokeStyle = stroke
      if (glow) {
        ctx.shadowColor = stroke
        ctx.shadowBlur = 12 * ratio
      }
      ctx.beginPath()
      ctx.arc(node.x, node.y, node.r + gap * px, 0, Math.PI * 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    ctx.globalAlpha = 1
    for (const node of list) {
      if (node.kind === 'more' || offscreen(node, node.r + 20 * px)) continue
      const access = node.kind === 'file' ? touched[node.path] : node.expanded ? undefined : inFolders.get(node.path)
      if (access) ring(node, 2.5, 2, access === 'edit' ? palette.edit : palette.read, true)
      if (node.path === selected) ring(node, access ? 6 : 3.5, keyboardMode ? 3 : 2, palette.selected, keyboardMode)
    }

    // Rótulos, en píxeles de pantalla. Aparecen al acercarse (las carpetas antes que los
    // archivos) y piden sitio por orden de importancia: el que pisaría a otro no se dibuja.
    // El seleccionado y lo que rodea al puntero se rotulan siempre.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const fileAlpha = clamp((k - 0.55) / 0.3, 0, 1)
    const folderAlpha = clamp((k - 0.15) / 0.2, 0, 1)
    /** Rótulos ya colocados, como [izquierda, arriba, derecha, abajo], por celda de la rejilla. */
    const placed = new Map<number, [number, number, number, number][]>()
    let font = ''
    const label = (node: NetNode, strong: boolean): void => {
      const alpha = strong ? 1 : (node.kind === 'folder' ? folderAlpha : fileAlpha) * (neighborhood ? 0.2 : 1) * (node.heavy ? 0.5 : 1)
      if (alpha < 0.05) return
      const x = node.x * k + view.x
      const y = (node.y + node.r) * k + view.y + 4
      const box: [number, number, number, number] = [x - node.labelWidth / 2 - 2, y, x + node.labelWidth / 2 + 2, y + LABEL_SIZE + 1]
      if (box[2] < 0 || box[0] > size.width || box[3] < 0 || box[1] > size.height) return
      const cells: number[] = []
      for (let cx = Math.floor(box[0] / LABEL_CELL_WIDTH); cx <= Math.floor(box[2] / LABEL_CELL_WIDTH); cx++) {
        for (let cy = Math.floor(box[1] / LABEL_CELL_HEIGHT); cy <= Math.floor(box[3] / LABEL_CELL_HEIGHT); cy++) {
          const cell = cx * 100003 + cy
          cells.push(cell)
          if (strong) continue
          for (const other of placed.get(cell) ?? []) {
            if (box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]) return
          }
        }
      }
      for (const cell of cells) {
        const list = placed.get(cell)
        if (list) list.push(box)
        else placed.set(cell, [box])
      }
      const wanted = labelFont(node)
      if (wanted !== font) {
        font = wanted
        ctx.font = font
      }
      ctx.globalAlpha = alpha
      ctx.fillStyle = strong ? palette.labelStrong : palette.label
      ctx.fillText(node.name, x, y)
    }
    const isStrong = (node: NetNode): boolean =>
      node === hovered || (node.kind !== 'more' && node.path === selected) || neighborhood?.has(node) === true
    for (const node of labelOrder) if (isStrong(node)) label(node, true)
    for (const node of labelOrder) if (!isStrong(node)) label(node, false)
    ctx.globalAlpha = 1
  }

  function tick(now: number): void {
    frame = 0
    const elapsed = Math.min(now - lastTime, 50)
    lastTime = now
    const simulating = simulation.alpha() >= simulation.alphaMin()
    if (simulating) simulation.tick()
    const moving = stepCamera(elapsed, simulating)
    // Si el grafo se mueve bajo un puntero quieto, lo que hay debajo cambia. Mientras la
    // simulación mueve los nodos solo se suelta el que se va: resaltar cada nodo que pasa
    // por debajo haría parpadear todo el grafo.
    if (pointer && (simulating || moving || settling)) {
      const under = nodeAt(pointer)
      if (!simulating || (hovered && under !== hovered)) setHovered(simulating ? null : under)
    }
    settling = simulating
    draw()
    if (simulating || moving) invalidate()
  }

  // ---- Puntero ----

  const local = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function nodeAt(point: { x: number; y: number }): NetNode | null {
    const x = (point.x - view.x) / view.k
    const y = (point.y - view.y) / view.k
    let best: NetNode | null = null
    let bestDistance = Infinity
    for (const node of list) {
      const distance = Math.hypot(node.x - x, node.y - y)
      // Los nodos pequeños se pueden coger aunque el puntero no acierte de lleno.
      if (distance <= Math.max(node.r, 8 / view.k) && distance < bestDistance) {
        best = node
        bestDistance = distance
      }
    }
    return best
  }

  function setHovered(node: NetNode | null): void {
    if (node === hovered) return
    hovered = node
    neighborhood = null
    if (node) {
      neighborhood = new Set([node])
      for (const { source, target } of links) {
        if (source === node) neighborhood.add(target)
        else if (target === node) neighborhood.add(source)
      }
    }
    canvas.style.cursor = node ? 'pointer' : ''
    invalidate()
  }

  function onPointerDown(down: PointerEvent): void {
    if (down.button !== 0) return
    const grabbed = nodeAt(local(down))
    let last = { x: down.clientX, y: down.clientY }
    let dragging = false

    const onMove = (move: PointerEvent): void => {
      if (!dragging && Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) < DRAG_THRESHOLD) return
      dragging = true
      follow = null
      pointer = null
      if (grabbed) {
        // El nodo sigue al puntero y los demás se recolocan a su alrededor.
        const point = local(move)
        grabbed.fx = (point.x - view.x) / view.k
        grabbed.fy = (point.y - view.y) / view.k
        simulation.alphaTarget(0.25)
        heat(0.25)
      } else {
        canvas.style.cursor = 'grabbing'
        view.x += move.clientX - last.x
        view.y += move.clientY - last.y
        invalidate()
      }
      last = { x: move.clientX, y: move.clientY }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (grabbed && dragging) {
        grabbed.fx = null
        grabbed.fy = null
        simulation.alphaTarget(0)
      } else if (grabbed) {
        onActivate(grabbed)
      }
      if (dragging) canvas.style.cursor = hovered ? 'pointer' : ''
      invalidate()
    }
    // En la ventana: el arrastre sigue aunque el puntero salga del lienzo.
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 0) return
    pointer = local(event)
    setHovered(nodeAt(pointer))
  }
  const onPointerLeave = (): void => {
    pointer = null
    setHovered(null)
  }
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const point = local(event)
    // Con Ctrl llega el gesto de pellizco del touchpad, con deltas mucho más pequeños.
    zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), point.x, point.y)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  // ---- Tamaño ----

  const resize = (): void => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    const ratio = window.devicePixelRatio || 1
    // El centro de la vista se queda donde estaba.
    view.x += (width - size.width) / 2
    view.y += (height - size.height) / 2
    size.width = width
    size.height = height
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    invalidate()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  return {
    setTree(items) {
      const next = new Map<string, NetNode>()
      let changed = items.length !== nodes.size
      for (const item of items) {
        let node = nodes.get(item.id)
        if (node) {
          Object.assign(node, item)
        } else {
          changed = true
          // Los nodos nuevos brotan de su carpeta.
          const origin = item.parent === null ? undefined : next.get(item.parent)
          const angle = Math.random() * Math.PI * 2
          const distance = origin ? origin.r + 10 + Math.random() * 20 : 0
          node = {
            ...item,
            r: 0,
            labelWidth: 0,
            x: (origin?.x ?? 0) + Math.cos(angle) * distance,
            y: (origin?.y ?? 0) + Math.sin(angle) * distance
          }
          ctx.font = labelFont(node)
          node.labelWidth = ctx.measureText(node.name).width
        }
        node.r = radiusOf(node)
        next.set(item.id, node)
      }
      const first = nodes.size === 0
      nodes = next
      list = [...next.values()]
      labelOrder = [...list].sort((a, b) => b.r - a.r)
      links = list.filter((node) => node.parent !== null).map((node) => ({ source: next.get(node.parent!)!, target: node }))
      simulation.nodes(list)
      linkForce.links(links)
      if (hovered && !next.has(hovered.id)) setHovered(null)
      if (changed) heat(first ? 1 : 0.5)
      else invalidate()
    },

    handleRequest(request) {
      if (request.id === handledRequest) return true
      // 'keep' es para los saltos del layout de árbol: aquí las posiciones no saltan.
      if (request.kind === 'fit') {
        follow = { kind: 'fit' }
      } else if (request.kind === 'focus') {
        const node = nodes.get(request.path)
        if (!node) return false
        const x = node.x * view.k + view.x
        const y = node.y * view.k + view.y
        const onScreen = x >= 0 && y >= 0 && x <= size.width && y <= size.height
        // Solo se desplaza: el zoom lo decide quien mira (el rótulo del seleccionado siempre se ve).
        if (!(request.ifHidden && onScreen)) follow = { kind: 'node', id: node.id, quick: request.quick === true }
      }
      handledRequest = request.id
      invalidate()
      return true
    },

    setKeyboardMode(on) {
      keyboardMode = on
      invalidate()
    },

    zoomBy(factor) {
      zoomAt(factor, size.width / 2, size.height / 2)
    },

    fit() {
      follow = { kind: 'fit' }
      invalidate()
    },

    spatial(path, key) {
      const from = nodes.get(path)
      if (!from) return null
      const [dx, dy] = ARROWS[key]
      let best: NetNode | null = null
      let bestScore = Infinity
      for (const node of list) {
        if (node === from || node.kind === 'more') continue
        const distance = Math.hypot(node.x - from.x, node.y - from.y)
        if (distance === 0) continue
        const alignment = ((node.x - from.x) * dx + (node.y - from.y) * dy) / distance
        if (alignment < ARROW_CONE) continue
        // Gana el más cercano, con ventaja para los que están justo en la dirección de la flecha.
        const score = distance * (2 - alignment)
        if (score < bestScore) {
          best = node
          bestScore = score
        }
      }
      return best?.path ?? null
    },

    redraw: invalidate,

    destroy() {
      destroyed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
    }
  }
}
