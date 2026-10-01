import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FileContent, FsEntry, IndexEntry } from '../shared/ipc'
import { t } from './i18n'

/** Nunca se muestran. */
const HIDDEN_DIRS = new Set(['.git', '.svn', '.hg'])

/** Se muestran atenuadas y se pueden expandir, pero no entran en el índice de búsqueda. */
const HEAVY_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  '.idea',
  '.vs'
])

const MAX_INDEX_ENTRIES = 50_000
const MAX_EDITABLE_BYTES = 5 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8000

/**
 * Cambios que el watcher ignora: dentro de carpetas ocultas o pesadas.
 * La creación/borrado de la carpeta pesada en sí (p. ej. "node_modules") sí cuenta.
 */
export function isWatchIgnored(relPath: string): boolean {
  const parts = relPath.split('/')
  if (parts.some((p) => HIDDEN_DIRS.has(p))) return true
  return parts.slice(0, -1).some((p) => HEAVY_DIRS.has(p))
}

/** Convierte una ruta relativa del renderer en absoluta, rechazando cualquier cosa fuera de la raíz. */
export function resolveInside(root: string, relPath: string): string {
  if (typeof relPath !== 'string') throw new Error(t('error.invalidPath'))
  const abs = path.resolve(root, relPath)
  const rel = path.relative(root, abs)
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(t('error.outsideProject', { path: relPath }))
  }
  return abs
}

function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

async function kindOf(dirent: import('node:fs').Dirent, absPath: string): Promise<FsEntry['kind'] | null> {
  if (dirent.isDirectory()) return 'directory'
  if (dirent.isFile()) return 'file'
  if (dirent.isSymbolicLink()) {
    try {
      const stat = await fs.stat(absPath)
      return stat.isDirectory() ? 'directory' : 'file'
    } catch {
      return null // enlace roto
    }
  }
  return null // sockets, pipes, etc.
}

export async function listDir(root: string, relPath: string): Promise<FsEntry[]> {
  const absDir = resolveInside(root, relPath)
  const dirents = await fs.readdir(absDir, { withFileTypes: true })

  const entries = await Promise.all(
    dirents
      .filter((d) => !(d.isDirectory() && HIDDEN_DIRS.has(d.name)))
      .map(async (d): Promise<FsEntry | null> => {
        const kind = await kindOf(d, path.join(absDir, d.name))
        if (!kind) return null
        const entry: FsEntry = { path: joinRel(relPath, d.name), name: d.name, kind }
        if (kind === 'directory' && HEAVY_DIRS.has(d.name)) entry.heavy = true
        return entry
      })
  )

  return entries
    .filter((e): e is FsEntry => e !== null)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
}

/**
 * Recorre el proyecto completo (en anchura) para alimentar el buscador.
 * No sigue enlaces simbólicos a carpetas para evitar ciclos.
 */
export async function buildIndex(root: string): Promise<{ entries: IndexEntry[]; truncated: boolean }> {
  const entries: IndexEntry[] = []
  const queue: string[] = ['']

  for (let i = 0; i < queue.length; i++) {
    const dir = queue[i]
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await fs.readdir(resolveInside(root, dir), { withFileTypes: true })
    } catch {
      continue // sin permisos o borrada mientras recorríamos
    }

    for (const d of dirents) {
      const rel = joinRel(dir, d.name)
      if (d.isDirectory()) {
        if (HIDDEN_DIRS.has(d.name) || HEAVY_DIRS.has(d.name)) continue
        entries.push({ path: rel, kind: 'directory' })
        queue.push(rel)
      } else if (d.isFile() || d.isSymbolicLink()) {
        entries.push({ path: rel, kind: 'file' })
      }
      if (entries.length >= MAX_INDEX_ENTRIES) return { entries, truncated: true }
    }
  }

  return { entries, truncated: false }
}

function looksBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < end; i++) if (buf[i] === 0) return true
  return false
}

export async function readFileContent(root: string, relPath: string): Promise<FileContent> {
  const abs = resolveInside(root, relPath)
  const { size } = await fs.stat(abs)
  if (size > MAX_EDITABLE_BYTES) return { kind: 'too-large', size }
  const buf = await fs.readFile(abs)
  if (looksBinary(buf)) return { kind: 'binary', size }
  return { kind: 'text', content: buf.toString('utf8') }
}

export async function writeFileContent(root: string, relPath: string, content: string): Promise<void> {
  if (typeof content !== 'string') throw new Error(t('error.invalidContent'))
  await fs.writeFile(resolveInside(root, relPath), content, 'utf8')
}
