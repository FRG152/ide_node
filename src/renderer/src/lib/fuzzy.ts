import type { IndexEntry } from '../../../shared/ipc'

export interface SearchResult extends IndexEntry {
  score: number
}

const BOUNDARY = new Set(['/', '.', '-', '_', ' '])

/**
 * Puntuación tipo "Ctrl+P": la consulta debe aparecer como subsecuencia de la ruta.
 * Premia coincidencias consecutivas, dentro del nombre del archivo y al inicio de palabra.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const nameStart = target.lastIndexOf('/') + 1
  let score = 0
  let from = 0
  let prev = -2

  for (const ch of query) {
    const found = target.indexOf(ch, from)
    if (found === -1) return null
    score += 1
    if (found === prev + 1) score += 5
    if (found >= nameStart) score += 2
    if (found === 0 || BOUNDARY.has(target[found - 1])) score += 3
    prev = found
    from = found + 1
  }

  const name = target.slice(nameStart)
  if (name === query) score += 100
  else if (name.startsWith(query)) score += 40
  else if (name.includes(query)) score += 20

  return score - target.length * 0.05
}

export function fuzzySearch(entries: IndexEntry[], rawQuery: string, limit: number): SearchResult[] {
  const query = rawQuery.trim().toLowerCase().replace(/\\/g, '/').replace(/\s+/g, '')
  if (!query) return []

  const results: SearchResult[] = []
  for (const entry of entries) {
    const score = fuzzyScore(query, entry.path.toLowerCase())
    if (score !== null) results.push({ ...entry, score })
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}
