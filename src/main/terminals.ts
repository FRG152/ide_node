import { execFile, execFileSync } from 'node:child_process'
import * as pty from 'node-pty'
import type { TerminalCreateOptions } from '../shared/ipc'

/** Agrupa la salida del pty para no mandar un mensaje IPC por cada trozo. */
const FLUSH_MS = 8

/** Variables que pone Electron / electron-vite y no deben heredar los procesos del usuario
 * (si el proyecto abierto es otra app de Electron, cargaría nuestro renderer). */
const PRIVATE_ENV = [
  'ELECTRON_RENDERER_URL',
  'ELECTRON_CLI_ARGS',
  'ELECTRON_ENTRY',
  'ELECTRON_RUN_AS_NODE',
  'NODE_ENV_ELECTRON_VITE',
  'REMOTE_DEBUGGING_PORT',
  'V8_INSPECTOR_PORT',
  'V8_INSPECTOR_BRK_PORT',
  'NO_SANDBOX'
]

interface Session {
  proc: pty.IPty
  pending: string
  timer: NodeJS.Timeout | null
}

export interface TerminalEvents {
  data(id: number, data: string): void
  exit(id: number, exitCode: number): void
}

export class TerminalManager {
  private sessions = new Map<number, Session>()
  private nextId = 1
  private windowsShell: Promise<string> | null = null

  constructor(private readonly events: TerminalEvents) {}

  async create(cwd: string, { command, cols, rows }: TerminalCreateOptions): Promise<number> {
    const [file, args] = command ? commandLine(command) : await this.interactiveShell()
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: clampSize(cols),
      rows: clampSize(rows),
      cwd,
      env: childEnv()
    })

    const id = this.nextId++
    const session: Session = { proc, pending: '', timer: null }
    this.sessions.set(id, session)

    proc.onData((data) => {
      session.pending += data
      session.timer ??= setTimeout(() => this.flush(id, session), FLUSH_MS)
    })
    proc.onExit(({ exitCode }) => {
      this.flush(id, session)
      this.sessions.delete(id)
      this.events.exit(id, exitCode)
    })
    return id
  }

  write(id: number, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.proc.resize(clampSize(cols), clampSize(rows))
    } catch {
      // el proceso acaba de terminar
    }
  }

  async kill(id: number): Promise<void> {
    const session = this.sessions.get(id)
    if (session) await killTree(session.proc)
  }

  /** Síncrono: se usa al cerrar la app o cambiar de proyecto. */
  killAll(): void {
    for (const { proc } of this.sessions.values()) killTreeSync(proc)
  }

  private flush(id: number, session: Session): void {
    if (session.timer) clearTimeout(session.timer)
    session.timer = null
    if (!session.pending) return
    this.events.data(id, session.pending)
    session.pending = ''
  }

  /**
   * En Windows preferimos PowerShell, pero si su política de ejecución bloquea scripts
   * (el valor por defecto, "Restricted"), `npm` falla porque resuelve a npm.ps1.
   * En ese caso usamos cmd.exe en lugar de saltarnos la política del sistema.
   */
  private async interactiveShell(): Promise<[string, string[]]> {
    if (process.platform !== 'win32') return [process.env.SHELL || '/bin/bash', ['-l']]
    this.windowsShell ??= new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Get-ExecutionPolicy'],
        { windowsHide: true, timeout: 5000 },
        (err, stdout) => {
          const policy = stdout.trim()
          const canRunScripts = !err && !['Restricted', 'AllSigned'].includes(policy)
          resolve(canRunScripts ? 'powershell.exe' : process.env.COMSPEC || 'cmd.exe')
        }
      )
    })
    const shell = await this.windowsShell
    return [shell, shell === 'powershell.exe' ? ['-NoLogo'] : []]
  }
}

/** Ejecuta un comando con la shell del sistema (como hace npm con sus scripts). */
function commandLine(command: string): [string, string | string[]] {
  if (process.platform === 'win32') return [process.env.COMSPEC || 'cmd.exe', `/d /s /c "${command}"`]
  return [process.env.SHELL || '/bin/sh', ['-lc', command]]
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !PRIVATE_ENV.includes(key)) env[key] = value
  }
  // Con la app en modo dev, Vite pone NODE_ENV=development; heredado, un `npm run build`
  // del proyecto del usuario compilaría en modo desarrollo.
  if (process.env.NODE_ENV_ELECTRON_VITE && env.NODE_ENV === 'development') delete env.NODE_ENV
  env.COLORTERM = 'truecolor'
  return env
}

function clampSize(n: number): number {
  return Number.isFinite(n) ? Math.max(1, Math.min(Math.floor(n), 1000)) : 80
}

// Matar solo el pty deja vivos a los hijos (p. ej. el servidor que lanzó `npm run dev`).
// Si el árbol se mató bien, no llamamos a proc.kill(): en Windows lanza un proceso
// auxiliar que falla ("AttachConsole failed") al no encontrar ya la consola.
function killTree(proc: pty.IPty): Promise<void> {
  if (process.platform !== 'win32') {
    killTreeSync(proc)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, (err) => {
      if (err) safeKill(proc)
      resolve()
    })
  })
}

function killTreeSync(proc: pty.IPty): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } else {
      process.kill(-proc.pid, 'SIGKILL') // node-pty crea un grupo de procesos por terminal
    }
  } catch {
    safeKill(proc)
  }
}

function safeKill(proc: pty.IPty): void {
  try {
    proc.kill()
  } catch {
    // ya había terminado
  }
}
