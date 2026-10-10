/**
 * Convierte las acciones del control con las manos en eventos de ratón sintéticos sobre lo
 * que haya bajo el cursor. Así la mano maneja toda la interfaz (grafo en sus dos vistas,
 * botones, listas…) sin que nada sepa que no es un ratón.
 */
import type { PointerDriver } from './gestures'

/** Clase que marca lo que se clicaría: los eventos sintéticos no activan el :hover de CSS. */
const HOVER_CLASS = 'hand-hover'
const CLICKABLE = 'button, a, input, select, textarea, [role="button"], .node, .minimized-item, .terminal-tab, .search-results li'
const FOCUSABLE = 'input, textarea, select, button, [tabindex], [contenteditable="true"]'
/** Sensibilidad de la rueda que entienden d3-zoom (vista de árbol) y la vista de red. */
const WHEEL_PER_LOG_ZOOM = 1 / 0.0014

export function createPointerDriver(cursor: HTMLElement): PointerDriver {
  let over: Element | null = null
  let highlighted: Element | null = null
  /** Dónde empezó la pulsación: el clic solo cuenta si se suelta sobre lo mismo. */
  let pressedOn: Element | null = null

  const place = (x: number, y: number, pressed: boolean): void => {
    cursor.style.transform = `translate(${x}px, ${y}px)`
    cursor.hidden = false
    cursor.classList.toggle('pressed', pressed)
  }

  const fire = (target: Element, type: string, x: number, y: number, buttons: number, button = 0): void => {
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button, buttons }
    target.dispatchEvent(
      type.startsWith('pointer')
        ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true })
        : new MouseEvent(type, init)
    )
  }

  /** El elemento bajo el cursor, avisando de la entrada y la salida como hace un ratón. */
  const targetAt = (x: number, y: number, buttons: number): Element => {
    const target = document.elementFromPoint(x, y) ?? document.body
    if (target !== over) {
      if (over?.isConnected) {
        fire(over, 'pointerout', x, y, buttons)
        fire(over, 'mouseout', x, y, buttons)
      }
      fire(target, 'pointerover', x, y, buttons)
      fire(target, 'mouseover', x, y, buttons)
      over = target
      const clickable = target.closest(CLICKABLE)
      if (clickable !== highlighted) {
        highlighted?.classList.remove(HOVER_CLASS)
        clickable?.classList.add(HOVER_CLASS)
        highlighted = clickable
      }
    }
    return target
  }

  return {
    move(x, y, pressed) {
      place(x, y, pressed)
      const buttons = pressed ? 1 : 0
      const target = targetAt(x, y, buttons)
      fire(target, 'pointermove', x, y, buttons, -1)
      fire(target, 'mousemove', x, y, buttons)
    },

    press(x, y) {
      place(x, y, true)
      const target = targetAt(x, y, 0)
      pressedOn = target
      fire(target, 'pointerdown', x, y, 1)
      fire(target, 'mousedown', x, y, 1)
      // Lo que haría el navegador con una pulsación de verdad: llevar el foco a lo pulsado.
      target.closest<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true })
    },

    release(x, y, click) {
      place(x, y, false)
      const target = targetAt(x, y, 1)
      fire(target, 'pointerup', x, y, 0)
      fire(target, 'mouseup', x, y, 0)
      const origin = pressedOn
      pressedOn = null
      if (click && origin?.isConnected && (origin === target || origin.contains(target) || target.contains(origin))) {
        fire(origin, 'click', x, y, 0)
      }
    },

    zoom(x, y, factor) {
      const target = document.elementFromPoint(x, y) ?? document.body
      target.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: x,
          clientY: y,
          deltaY: -Math.log(factor) * WHEEL_PER_LOG_ZOOM,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL
        })
      )
    },

    hide() {
      cursor.hidden = true
      if (over?.isConnected) {
        fire(over, 'pointerout', 0, 0, 0)
        fire(over, 'mouseout', 0, 0, 0)
      }
      over = null
      highlighted?.classList.remove(HOVER_CLASS)
      highlighted = null
      pressedOn = null
    }
  }
}
