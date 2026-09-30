import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { FsChanges } from '../shared/ipc'
import { isWatchIgnored } from './fileSystem'

/** Agrupamos ráfagas de eventos (un `npm install`, un build...) en un único envío. */
const FLUSH_DELAY_MS = 150

/** Vigila la carpeta del proyecto (recursivo, nativo en Windows y macOS). */
export class ProjectWatcher {
  private watcher: FSWatcher | null = null
  private structural = new Set<string>()
  private modified = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly onChanges: (changes: FsChanges) => void) {}

  start(root: string): void {
    this.stop()
    try {
      this.watcher = watch(root, { recursive: true }, (event, filename) => {
        if (!filename) return
        const rel = filename.split(path.sep).join('/')
        if (isWatchIgnored(rel)) return
        // 'rename' = creado, borrado o renombrado; 'change' = contenido modificado
        ;(event === 'rename' ? this.structural : this.modified).add(rel)
        this.timer ??= setTimeout(() => this.flush(root), FLUSH_DELAY_MS)
      })
      // Por ejemplo, si se borra la carpeta raíz.
      this.watcher.on('error', () => this.stop())
    } catch {
      // Sistema sin watch recursivo: el usuario puede seguir usando "Refrescar".
      this.watcher = null
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.structural.clear()
    this.modified.clear()
  }

  private flush(root: string): void {
    this.timer = null
    const changes: FsChanges = { rootPath: root, structural: [...this.structural], modified: [...this.modified] }
    this.structural.clear()
    this.modified.clear()
    this.onChanges(changes)
  }
}
