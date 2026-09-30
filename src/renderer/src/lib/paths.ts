/** Utilidades para rutas relativas con "/" (la raíz del proyecto es ""). */

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function depthOf(path: string): number {
  return path === '' ? 0 : path.split('/').length
}

/** Carpetas que contienen a `path`, desde la raíz: "src/a/b.ts" -> ["", "src", "src/a"]. */
export function ancestorsOf(path: string): string[] {
  if (path === '') return []
  const parts = path.split('/')
  const result = ['']
  for (let i = 1; i < parts.length; i++) result.push(parts.slice(0, i).join('/'))
  return result
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
