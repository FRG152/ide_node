import { Fragment } from 'react'
import { useT } from '../i18n'
import { classes } from '../lib/classes'
import { ancestorsOf, baseName } from '../lib/paths'
import { useProjectStore } from '../stores/projectStore'

/** Con más tramos que esto, los del medio se resumen en "…". */
const MAX_CRUMBS = 6
const TAIL_CRUMBS = 4

/**
 * Ruta del nodo seleccionado, arriba a la izquierda del grafo: en un árbol grande dice dónde
 * estás aunque la raíz quede lejos. Clic en un tramo: seleccionarlo y centrarlo.
 */
export function Breadcrumbs() {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const selected = useProjectStore((s) => s.selected) ?? ''
  const focus = useProjectStore((s) => s.focus)
  if (!project) return null

  const path = [...ancestorsOf(selected), selected]
  const hidden = path.length > MAX_CRUMBS ? path.slice(1, path.length - TAIL_CRUMBS) : []
  const shown = hidden.length > 0 ? [path[0], null, ...path.slice(path.length - TAIL_CRUMBS)] : path

  return (
    <nav className="breadcrumbs" aria-label={t('breadcrumbs.label')}>
      {shown.map((crumb, i) => (
        <Fragment key={crumb ?? '…'}>
          {i > 0 && <span className="breadcrumbs-separator">›</span>}
          {crumb === null ? (
            <span className="breadcrumbs-ellipsis" title={hidden.map(baseName).join(' / ')}>
              …
            </span>
          ) : (
            <button
              className={classes('breadcrumbs-item', crumb === selected && 'current')}
              onClick={() => focus(crumb)}
              title={crumb || project.name}
            >
              {crumb === '' ? project.name : baseName(crumb)}
            </button>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
