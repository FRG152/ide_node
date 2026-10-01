/**
 * Ejecuta en la interfaz las acciones que Claude pide con las herramientas mcp__ide_node__*
 * (el main las recibe del servidor MCP y las reenvía aquí).
 */
import type { FsEntry, IdeCommand } from '../../../shared/ipc'
import { errorMessage } from '../lib/errors'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'

/** Pausa tras cada acción para que el usuario pueda seguir el recorrido de Claude en el grafo. */
const STEP_PAUSE_MS = 500
const MAX_LISTED = 200

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS))
const label = (path: string): string => (path === '' ? 'la raíz del proyecto' : `"${path}"`)

async function requireEntry(path: string): Promise<FsEntry> {
  const entry = await useProjectStore.getState().ensureLoaded(path)
  if (!entry) throw new Error(`${label(path)} no existe en el proyecto`)
  return entry
}

function describeFolder(path: string): string {
  const { children, entries } = useProjectStore.getState()
  const kids = children[path] ?? []
  if (kids.length === 0) return `${label(path)} está vacía.`
  const lines = kids.slice(0, MAX_LISTED).map((p) => {
    const entry = entries[p]
    if (entry.kind === 'file') return entry.name
    return `${entry.name}/${entry.heavy ? '  (dependencias o compilados)' : ''}`
  })
  if (kids.length > MAX_LISTED) lines.push(`… y ${kids.length - MAX_LISTED} más`)
  return `Contenido de ${label(path)}:\n${lines.join('\n')}`
}

function describeView(): string {
  const { project, selected, expanded } = useProjectStore.getState()
  const { active, minimized, dirty } = useEditorStore.getState()
  const folders = Object.keys(expanded)
    .filter((p) => p !== '')
    .sort()
  return [
    `Proyecto: ${project?.name ?? '(ninguno)'}`,
    `Nodo seleccionado: ${selected === null ? '(ninguno)' : label(selected)}`,
    `Archivo en el editor: ${active ? `${active}${dirty[active] ? ' (con cambios sin guardar)' : ''}` : '(ninguno a la vista)'}`,
    `Archivos minimizados: ${minimized.join(', ') || '(ninguno)'}`,
    `Carpetas expandidas: ${folders.slice(0, 50).join(', ') || '(solo la raíz)'}`
  ].join('\n')
}

async function execute(command: IdeCommand): Promise<string> {
  const project = useProjectStore.getState()
  switch (command.type) {
    case 'expand_folder': {
      const { path } = command
      if ((await requireEntry(path)).kind !== 'directory') throw new Error(`${label(path)} es un archivo: usa open_file`)
      await project.expandTo(path)
      if (!useProjectStore.getState().expanded[path]) await project.toggleFolder(path)
      useProjectStore.getState().focus(path)
      await pause()
      return describeFolder(path)
    }

    case 'collapse_folder': {
      const { path } = command
      if ((await requireEntry(path)).kind !== 'directory') throw new Error(`${label(path)} es un archivo`)
      if (useProjectStore.getState().expanded[path]) await project.toggleFolder(path)
      await pause()
      return `${label(path)} colapsada.`
    }

    case 'select_node': {
      const { path } = command
      await requireEntry(path)
      await project.reveal(path, { openFile: false })
      await pause()
      return `${label(path)} seleccionado en el grafo.`
    }

    case 'open_file': {
      const { path, line } = command
      if ((await requireEntry(path)).kind !== 'file') throw new Error(`${label(path)} es una carpeta: usa expand_folder`)
      await project.reveal(path)
      if (line) useEditorStore.getState().goToLine(path, line)
      await pause()
      return `${path} abierto en el editor${line ? ` en la línea ${line}` : ''}.`
    }

    case 'get_view':
      return describeView()
  }
}

window.api.onIdeCommand((id, command) => {
  execute(command).then(
    (text) => window.api.ideCommandResult(id, true, text),
    (err) => window.api.ideCommandResult(id, false, errorMessage(err))
  )
})
