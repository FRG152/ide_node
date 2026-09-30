import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { fuzzySearch, type SearchResult } from '../lib/fuzzy'
import { baseName, parentOf } from '../lib/paths'
import { FOCUS_SEARCH_EVENT } from '../lib/shortcuts'
import { useProjectStore } from '../stores/projectStore'

const MAX_RESULTS = 50

export function SearchBar() {
  const index = useProjectStore((s) => s.index)
  const indexing = useProjectStore((s) => s.indexing)
  const hasProject = useProjectStore((s) => s.project !== null)
  const reveal = useProjectStore((s) => s.reveal)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const results = useMemo(() => fuzzySearch(index, query, MAX_RESULTS), [index, query])

  // Ctrl+P (atajo global) enfoca el buscador, como en VS Code.
  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener(FOCUS_SEARCH_EVENT, focus)
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus)
  }, [])

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (result: SearchResult): void => {
    void reveal(result.path)
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const result = results[active]
      if (result) choose(result)
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div className="search">
      <input
        ref={inputRef}
        value={query}
        disabled={!hasProject}
        placeholder={hasProject ? 'Buscar archivo o carpeta (Ctrl+P)' : 'Abre una carpeta para buscar'}
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && query.trim() && (
        <ul className="search-results" ref={listRef}>
          {results.length === 0 && <li className="search-empty">{indexing ? 'Indexando…' : 'Sin resultados'}</li>}
          {results.map((r, i) => (
            <li
              key={r.path}
              className={i === active ? 'active' : undefined}
              // mousedown en vez de click: se dispara antes del blur que cierra la lista
              onMouseDown={(e) => {
                e.preventDefault()
                choose(r)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="search-kind">{r.kind === 'directory' ? '▸' : '·'}</span>
              <span className="search-name">{baseName(r.path)}</span>
              <span className="search-dir">{parentOf(r.path)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
