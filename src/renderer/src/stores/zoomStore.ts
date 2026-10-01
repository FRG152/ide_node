import { create } from 'zustand'
import { loadSetting, saveSetting } from '../lib/settings'

/**
 * Zoom como en VS Code:
 * - Ventana (Ctrl +/-/0): escala toda la interfaz. Nivel de Electron: cada paso ×1.2.
 * - Letra por panel (Ctrl+rueda sobre el editor o la terminal), como su `mouseWheelZoom`.
 */

/** Paneles con tamaño de letra propio. */
export type ZoomTarget = 'editor' | 'terminal'

export const DEFAULT_FONT_SIZE = 13
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32
const MIN_WINDOW_LEVEL = -4
const MAX_WINDOW_LEVEL = 6
const STORAGE_KEY = 'ide-node:zoom'

interface SavedZoom {
  windowLevel: number
  fontSize: Record<ZoomTarget, number>
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

function validFontSize(value: unknown): number {
  return typeof value === 'number' ? clamp(Math.round(value), MIN_FONT_SIZE, MAX_FONT_SIZE) : DEFAULT_FONT_SIZE
}

// Preferencia local de este equipo: si el almacenamiento falla, se usan los valores por defecto.
function load(): SavedZoom {
  try {
    const saved = JSON.parse(loadSetting(STORAGE_KEY) ?? 'null') as Partial<SavedZoom> | null
    return {
      windowLevel:
        typeof saved?.windowLevel === 'number'
          ? clamp(Math.round(saved.windowLevel), MIN_WINDOW_LEVEL, MAX_WINDOW_LEVEL)
          : 0,
      fontSize: { editor: validFontSize(saved?.fontSize?.editor), terminal: validFontSize(saved?.fontSize?.terminal) }
    }
  } catch {
    return { windowLevel: 0, fontSize: { editor: DEFAULT_FONT_SIZE, terminal: DEFAULT_FONT_SIZE } }
  }
}

function save(zoom: SavedZoom): void {
  saveSetting(STORAGE_KEY, JSON.stringify(zoom))
}

/** Porcentaje que corresponde a un nivel de zoom de Electron. */
export const windowZoomPercent = (level: number): number => Math.round(1.2 ** level * 100)

interface ZoomState extends SavedZoom {
  /** +1 acerca, -1 aleja. */
  zoomWindow: (direction: 1 | -1) => void
  resetWindow: () => void
  zoomFont: (target: ZoomTarget, direction: 1 | -1) => void
  resetFont: (target: ZoomTarget) => void
}

const initial = load()
window.api.setZoomLevel(initial.windowLevel)

export const useZoomStore = create<ZoomState>()((set, get) => {
  function update(patch: Partial<SavedZoom>): void {
    set(patch)
    const { windowLevel, fontSize } = get()
    save({ windowLevel, fontSize })
  }

  function setWindowLevel(level: number): void {
    const clamped = clamp(level, MIN_WINDOW_LEVEL, MAX_WINDOW_LEVEL)
    if (clamped === get().windowLevel) return
    window.api.setZoomLevel(clamped)
    update({ windowLevel: clamped })
  }

  function setFontSize(target: ZoomTarget, size: number): void {
    const clamped = clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE)
    if (clamped === get().fontSize[target]) return
    update({ fontSize: { ...get().fontSize, [target]: clamped } })
  }

  return {
    ...initial,
    zoomWindow: (direction) => setWindowLevel(get().windowLevel + direction),
    resetWindow: () => setWindowLevel(0),
    zoomFont: (target, direction) => setFontSize(target, get().fontSize[target] + direction),
    resetFont: (target) => setFontSize(target, DEFAULT_FONT_SIZE)
  }
})

/** Una muesca de rueda de ratón son ~100 px de delta; los trackpads mandan muchos eventos pequeños. */
const WHEEL_STEP = 100

/** Ctrl+rueda sobre `element` cambia la letra de `target`. Devuelve la función para quitarlo. */
export function attachWheelZoom(element: HTMLElement, target: ZoomTarget): () => void {
  let accumulated = 0
  const onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey) return
    // En captura y cancelando: que Monaco/xterm no lo traten como scroll.
    e.preventDefault()
    e.stopPropagation()
    if (Math.sign(e.deltaY) !== Math.sign(accumulated)) accumulated = 0
    accumulated += e.deltaY
    while (Math.abs(accumulated) >= WHEEL_STEP) {
      useZoomStore.getState().zoomFont(target, accumulated < 0 ? 1 : -1)
      accumulated -= Math.sign(accumulated) * WHEEL_STEP
    }
  }
  element.addEventListener('wheel', onWheel, { passive: false, capture: true })
  return () => element.removeEventListener('wheel', onWheel, { capture: true })
}
