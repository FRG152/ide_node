/**
 * Instancias de xterm por terminal. Viven fuera de React: si el panel se oculta o se
 * cambia de pestaña, la terminal sigue recibiendo salida y se vuelve a enganchar al DOM.
 */
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useZoomStore } from '../stores/zoomStore'

interface Instance {
  term: Terminal
  fit: FitAddon
  /** Contenedor propio de xterm; se mueve entre montajes del componente. */
  host: HTMLDivElement
  opened: boolean
}

/** Paleta de Claude Code (ver styles.css). */
const CLAUDE_TERMINAL_THEME = {
  background: '#1f1e1d',
  foreground: '#f5f4ef',
  cursor: '#d77757',
  cursorAccent: '#1f1e1d',
  selectionBackground: 'rgba(215, 119, 87, 0.35)',
  black: '#1f1e1d',
  red: '#ff6b80',
  green: '#4eba65',
  yellow: '#ffc107',
  blue: '#4782c8',
  magenta: '#af87ff',
  cyan: '#48968c',
  white: '#c2c0b6',
  brightBlack: '#6b6a65',
  brightRed: '#ff8a9a',
  brightGreen: '#6fd486',
  brightYellow: '#ffd54f',
  brightBlue: '#b1b9f9',
  brightMagenta: '#c9a8ff',
  brightCyan: '#6fb8ad',
  brightWhite: '#f5f4ef',
  scrollbarSliderBackground: 'rgba(215, 119, 87, 0.22)',
  scrollbarSliderHoverBackground: 'rgba(235, 159, 127, 0.7)',
  scrollbarSliderActiveBackground: '#d77757'
}

const instances = new Map<number, Instance>()
const isWindows = navigator.userAgent.includes('Windows')

window.api.onTerminalData((id, data) => instances.get(id)?.term.write(data))

// Cambiar la letra cambia cuántas columnas/filas caben: reajustamos cada terminal (y su pty).
useZoomStore.subscribe((state, prev) => {
  if (state.fontSize.terminal === prev.fontSize.terminal) return
  for (const [id, instance] of instances) {
    instance.term.options.fontSize = state.fontSize.terminal
    fitInstance(id)
  }
})

export function createInstance(id: number, banner?: string, options: { shiftEnterNewline?: boolean } = {}): void {
  const term = new Terminal({
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: useZoomStore.getState().fontSize.terminal,
    cursorBlink: true,
    scrollback: 10_000,
    theme: CLAUDE_TERMINAL_THEME,
    windowsPty: isWindows ? { backend: 'conpty' } : undefined
  })
  const fit = new FitAddon()
  term.loadAddon(fit)

  term.onData((data) => window.api.terminalWrite(id, data))
  term.onResize(({ cols, rows }) => window.api.terminalResize(id, cols, rows))

  // Como en VS Code: Ctrl+C copia si hay texto seleccionado (si no, interrumpe),
  // y Ctrl+V se deja al navegador para que dispare el evento paste.
  term.attachCustomKeyEventHandler((e) => {
    // En Claude Code, Alt+Enter (ESC + CR) es "nueva línea": Shift+Enter hace lo mismo, como
    // tras su /terminal-setup en VS Code. Sin esto, xterm envía Enter y el mensaje se manda.
    if (options.shiftEnterNewline && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
      if (e.type === 'keydown') window.api.terminalWrite(id, '\x1b\r')
      return false
    }
    if (e.type !== 'keydown' || !e.ctrlKey || e.shiftKey || e.altKey) return true
    if (e.key === 'c' && term.hasSelection()) return false
    if (e.key === 'v') return false
    return true
  })

  if (banner) term.write(banner)

  const host = document.createElement('div')
  host.className = 'terminal-host'
  instances.set(id, { term, fit, host, opened: false })
}

/** Engancha la terminal a `container`. Devuelve la función para desengancharla. */
export function attachInstance(id: number, container: HTMLElement): () => void {
  const instance = instances.get(id)
  if (!instance) return () => {}
  container.appendChild(instance.host)
  if (!instance.opened) {
    instance.term.open(instance.host)
    instance.opened = true
  }
  fitInstance(id)
  // Mientras estuvo fuera del DOM xterm no pintó: forzamos un repintado completo.
  instance.term.refresh(0, instance.term.rows - 1)
  instance.term.focus()
  return () => instance.host.remove()
}

/** Tamaño mínimo razonable: por debajo, el panel se está montando o animando. */
const MIN_COLS = 20
const MIN_ROWS = 3

export function fitInstance(id: number): void {
  const instance = instances.get(id)
  if (!instance?.opened || !instance.host.isConnected) return
  // No usamos fit.fit() directamente: redimensionar el pty a 1 fila (panel recién montado)
  // hace que ConPTY repinte la pantalla y se pierda lo que había a la vista.
  const dims = instance.fit.proposeDimensions()
  if (!dims || dims.cols < MIN_COLS || dims.rows < MIN_ROWS) return
  if (dims.cols !== instance.term.cols || dims.rows !== instance.term.rows) {
    instance.term.resize(dims.cols, dims.rows)
  }
}

export function focusInstance(id: number): void {
  instances.get(id)?.term.focus()
}

export function writeToInstance(id: number, text: string): void {
  instances.get(id)?.term.write(text)
}

export function disposeInstance(id: number): void {
  const instance = instances.get(id)
  if (!instance) return
  instance.term.dispose()
  instance.host.remove()
  instances.delete(id)
}
