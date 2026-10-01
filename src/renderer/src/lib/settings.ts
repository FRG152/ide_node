/**
 * Preferencias locales (idioma, zoom...). Viven en localStorage; si falla, la app sigue
 * con los valores por defecto.
 */

let flushTimer: ReturnType<typeof setTimeout> | null = null

export function loadSetting(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function saveSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    return // sin almacenamiento: dura lo que dure la sesión
  }
  // Chromium escribe el localStorage a disco con segundos de retraso: si la app se cierra
  // de golpe (o electron-vite la reinicia en desarrollo) se perdería el último cambio.
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => window.api.flushStorage(), 300)
}
