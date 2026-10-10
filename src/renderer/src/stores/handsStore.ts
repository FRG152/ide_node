import { create } from 'zustand'

/**
 * Control con las manos (experimental). No se recuerda entre sesiones: enciende la cámara,
 * así que cada vez lo activa el usuario.
 *
 * - loading: cargando el modelo y pidiendo la cámara.
 * - searching: cámara en marcha, sin manos a la vista.
 * - tracking: hay una mano moviendo el cursor.
 */
export type HandsStatus = 'loading' | 'searching' | 'tracking' | 'no-model' | 'no-camera'

interface HandsState {
  enabled: boolean
  status: HandsStatus
  toggle: () => void
  setStatus: (status: HandsStatus) => void
}

export const useHandsStore = create<HandsState>()((set) => ({
  enabled: false,
  status: 'loading',
  toggle() {
    set((s) => ({ enabled: !s.enabled, status: 'loading' }))
  },
  setStatus(status) {
    set({ status })
  }
}))
