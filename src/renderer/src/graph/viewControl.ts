import type { RefObject } from 'react'
import type { GridNeighbors } from './buildGraph'

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

/** Lo que la vista activa del grafo (árbol o red) ofrece al panel que la contiene. */
export interface GraphViewControl {
  /** Acerca (> 1) o aleja (< 1) la cámara. */
  zoomBy: (factor: number) => void
  /** Vista de árbol: vecinos de fila dentro de las cuadrículas de hermanos. */
  gridNeighbors: Record<string, GridNeighbors>
  /**
   * Vista de red: nodo más cercano a `path` en la dirección de la flecha. Ahí los nodos no
   * están ordenados, así que el teclado se mueve por el espacio y no por el árbol.
   */
  spatial?: (path: string, key: ArrowKey) => string | null
}

export interface GraphViewProps {
  /** El panel del grafo: de él se mide el tamaño del lienzo. */
  container: RefObject<HTMLDivElement | null>
  control: RefObject<GraphViewControl | null>
}
