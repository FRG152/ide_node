/**
 * Control con las manos: de los puntos de la mano (los 21 de MediaPipe) a acciones de puntero.
 *
 * Aquí no hay cámara ni DOM: `update` recibe las manos de un fotograma y llama al `PointerDriver`.
 *
 * - Una mano a la vista: el cursor sigue al punto entre el pulgar y el índice.
 * - Pellizco (juntar pulgar e índice) y soltar sin moverse: clic.
 * - Pellizco y mover: arrastrar (mover el lienzo, un nodo…).
 * - Pellizco con las dos manos: separarlas o juntarlas hace zoom.
 */

export interface Point {
  x: number
  y: number
}

/** Una mano en un fotograma: 21 puntos en coordenadas de la imagen de la cámara (0..1, sin espejar). */
export interface HandFrame {
  landmarks: Point[]
  handedness: string
}

/** A dónde van las acciones: la app usa eventos de ratón sintéticos (pointer.ts). */
export interface PointerDriver {
  /** El cursor se mueve; `pressed` si hay un arrastre en curso. */
  move: (x: number, y: number, pressed: boolean) => void
  press: (x: number, y: number) => void
  /** Suelta. `click` si fue un toque (no se movió): cuenta como clic. */
  release: (x: number, y: number, click: boolean) => void
  /** Zoom alrededor de (x, y): factor > 1 acerca. */
  zoom: (x: number, y: number, factor: number) => void
  /** No hay mano a la vista. */
  hide: () => void
}

export interface GestureState {
  visible: boolean
  pressed: boolean
  zooming: boolean
}

export interface GestureEngine {
  /** Las manos detectadas en un fotograma (lista vacía si no hay ninguna) y su instante en ms. */
  update: (hands: HandFrame[], time: number) => GestureState
  /** Suelta lo que hubiera y oculta el cursor. */
  reset: () => void
}

// Índices de los puntos de MediaPipe Hands.
const WRIST = 0
const THUMB_TIP = 4
const INDEX_TIP = 8
const MIDDLE_KNUCKLE = 9

/** Zona de la imagen que se reparte por toda la ventana: no hace falta estirar el brazo a las esquinas. */
const ZONE = { left: 0.18, right: 0.82, top: 0.15, bottom: 0.75 }
/** Distancia pulgar-índice, relativa al tamaño de la mano, que empieza y termina un pellizco. */
const PINCH_ON = 0.25
const PINCH_OFF = 0.4
/** Píxeles que hay que moverse con el pellizco hecho para que sea un arrastre y no un clic. */
const DRAG_SLOP = 18
/** Sin ver la mano este tiempo, se da por perdida (y se suelta lo que tuviera cogido). */
const LOST_MS = 250
/** Límite del zoom por fotograma: un punto mal detectado no dispara la cámara. */
const MAX_ZOOM_STEP = 1.25

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const unit = (value: number, min: number, max: number): number => Math.min(1, Math.max(0, (value - min) / (max - min)))

/**
 * Filtro "1 euro": suaviza mucho cuando la mano está quieta (sin temblor para acertar a un
 * nodo) y casi nada cuando se mueve rápido (sin retraso).
 */
function oneEuro(minCutoff: number, beta: number): { filter: (value: number, time: number) => number; reset: () => void } {
  let current: number | null = null
  let speed = 0
  let last = 0
  const alpha = (cutoff: number, dt: number): number => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt)
  return {
    filter(value, time) {
      if (current === null) {
        current = value
        last = time
        return value
      }
      const dt = Math.max((time - last) / 1000, 1 / 240)
      last = time
      speed += alpha(1, dt) * ((value - current) / dt - speed)
      current += alpha(minCutoff + beta * Math.abs(speed), dt) * (value - current)
      return current
    },
    reset() {
      current = null
      speed = 0
    }
  }
}

interface Reading {
  /** Identifica a la mano entre fotogramas (su etiqueta; si las dos llevan la misma, se numeran). */
  key: string
  /** Punto del pellizco, en píxeles de la ventana (ya espejado: la cámara es un espejo). */
  point: Point
  /** Distancia pulgar-índice relativa al tamaño de la mano. */
  pinch: number
}

function read(hands: HandFrame[], width: number, height: number): Reading[] {
  const keys = new Set<string>()
  return hands.map((hand) => {
    let key = hand.handedness
    while (keys.has(key)) key += "'"
    keys.add(key)
    const thumb = hand.landmarks[THUMB_TIP]
    const index = hand.landmarks[INDEX_TIP]
    const size = distance(hand.landmarks[WRIST], hand.landmarks[MIDDLE_KNUCKLE]) || 1
    return {
      key,
      point: {
        x: unit(1 - (thumb.x + index.x) / 2, ZONE.left, ZONE.right) * width,
        y: unit((thumb.y + index.y) / 2, ZONE.top, ZONE.bottom) * height
      },
      pinch: distance(thumb, index) / size
    }
  })
}

export function createGestureEngine(driver: PointerDriver, viewport: () => { width: number; height: number }): GestureEngine {
  const filterX = oneEuro(1, 0.006)
  const filterY = oneEuro(1, 0.006)
  /** Mano que lleva el cursor: se mantiene mientras siga a la vista. */
  let primary: string | null = null
  let cursor: Point = { x: 0, y: 0 }
  let visible = false
  let lastSeen = 0
  /** Manos con el pellizco hecho (con histéresis: cuesta más soltarlo que hacerlo). */
  const pinched = new Set<string>()
  /** Pellizco de la mano principal: dónde empezó y si ya es un arrastre. */
  let press: { origin: Point; dragging: boolean } | null = null
  /** Zoom con las dos manos: distancia entre ellas en el fotograma anterior. */
  let zoomSpan: number | null = null
  /** Tras un zoom, el pellizco que continúa no es clic ni arrastre hasta que se suelte. */
  let awaitingRelease = false

  const isPinched = (reading: Reading): boolean => {
    const now = reading.pinch < (pinched.has(reading.key) ? PINCH_OFF : PINCH_ON)
    if (now) pinched.add(reading.key)
    else pinched.delete(reading.key)
    return now
  }

  /** Suelta sin clic: se perdió la mano, cambió de mano o empezó un zoom. */
  const cancelPress = (): void => {
    if (!press) return
    press = null
    driver.release(cursor.x, cursor.y, false)
  }

  const hide = (): void => {
    cancelPress()
    zoomSpan = null
    awaitingRelease = false
    primary = null
    pinched.clear()
    filterX.reset()
    filterY.reset()
    if (visible) driver.hide()
    visible = false
  }

  const state = (): GestureState => ({ visible, pressed: press !== null, zooming: zoomSpan !== null })

  return {
    update(hands, time) {
      if (hands.length === 0) {
        if (visible && time - lastSeen > LOST_MS) hide()
        return state()
      }
      lastSeen = time
      const { width, height } = viewport()
      const readings = read(hands, width, height)
      const main = readings.find((r) => r.key === primary) ?? readings[0]
      const other = readings.find((r) => r !== main)
      if (main.key !== primary) {
        // Otra mano toma el cursor: empieza desde donde está, sin heredar el filtro de la anterior.
        cancelPress()
        primary = main.key
        filterX.reset()
        filterY.reset()
      }
      for (const key of pinched) {
        if (!readings.some((r) => r.key === key)) pinched.delete(key)
      }

      cursor = { x: filterX.filter(main.point.x, time), y: filterY.filter(main.point.y, time) }
      visible = true
      const mainPinched = isPinched(main)
      const otherPinched = other !== undefined && isPinched(other)

      if (mainPinched && otherPinched) {
        // Las dos manos pellizcando: zoom alrededor del punto medio entre ellas.
        cancelPress()
        awaitingRelease = true
        const span = distance(main.point, other.point)
        if (zoomSpan !== null && zoomSpan > 0 && span > 0) {
          const factor = Math.min(MAX_ZOOM_STEP, Math.max(1 / MAX_ZOOM_STEP, span / zoomSpan))
          if (Math.abs(factor - 1) > 0.005) {
            driver.zoom((main.point.x + other.point.x) / 2, (main.point.y + other.point.y) / 2, factor)
          }
        }
        zoomSpan = span
        driver.move(cursor.x, cursor.y, false)
        return state()
      }
      zoomSpan = null
      if (!mainPinched) awaitingRelease = false

      if (mainPinched && press) {
        // Hasta pasar el umbral el cursor no se mueve: el temblor no convierte un clic en arrastre.
        if (!press.dragging && distance(cursor, press.origin) > DRAG_SLOP) press.dragging = true
        if (press.dragging) driver.move(cursor.x, cursor.y, true)
      } else if (mainPinched && !awaitingRelease) {
        press = { origin: cursor, dragging: false }
        driver.move(cursor.x, cursor.y, false)
        driver.press(cursor.x, cursor.y)
      } else if (press) {
        const { origin, dragging } = press
        press = null
        if (dragging) driver.release(cursor.x, cursor.y, false)
        else driver.release(origin.x, origin.y, true)
      } else {
        driver.move(cursor.x, cursor.y, false)
      }
      return state()
    },

    reset: hide
  }
}
