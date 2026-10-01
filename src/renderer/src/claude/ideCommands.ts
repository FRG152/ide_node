/**
 * Ejecuta en la interfaz las acciones que Claude pide con las herramientas mcp__ide_node__*
 * (el main las recibe del servidor MCP y las reenvía aquí).
 *
 * Los textos que devuelve este archivo los lee Claude, no el usuario: van en inglés.
 */
import type { FsEntry, IdeCommand } from '../../../shared/ipc'
import { errorMessage } from '../lib/errors'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'

/** Pausa tras cada acción para que el usuario pueda seguir el recorrido de Claude en el grafo. */
const STEP_PAUSE_MS = 500
const MAX_LISTED = 200

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS))
const label = (path: string): string => (path === '' ? 'the project root' : `"${path}"`)

async function requireEntry(path: string): Promise<FsEntry> {
  const entry = await useProjectStore.getState().ensureLoaded(path)
  if (!entry) throw new Error(`${label(path)} does not exist in the project`)
  return entry
}

function describeFolder(path: string): string {
  const { children, entries } = useProjectStore.getState()
  const kids = children[path] ?? []
  if (kids.length === 0) return `${label(path)} is empty.`
  const lines = kids.slice(0, MAX_LISTED).map((p) => {
    const entry = entries[p]
    if (entry.kind === 'file') return entry.name
    return `${entry.name}/${entry.heavy ? '  (dependencies or build output)' : ''}`
  })
  if (kids.length > MAX_LISTED) lines.push(`… and ${kids.length - MAX_LISTED} more`)
  return [`Contents of ${label(path)}:`, ...lines].join('\n')
}

function describeView(): string {
  const { project, selected, expanded } = useProjectStore.getState()
  const { active, minimized, dirty } = useEditorStore.getState()
  const folders = Object.keys(expanded)
    .filter((p) => p !== '')
    .sort()
  return [
    `Project: ${project?.name ?? '(none)'}`,
    `Selected node: ${selected === null ? '(none)' : label(selected)}`,
    `File in the editor: ${active ? `${active}${dirty[active] ? ' (unsaved changes)' : ''}` : '(none visible)'}`,
    `Minimized files: ${minimized.join(', ') || '(none)'}`,
    `Expanded folders: ${folders.slice(0, 50).join(', ') || '(only the root)'}`
  ].join('\n')
}

async function execute(command: IdeCommand): Promise<string> {
  const project = useProjectStore.getState()
  switch (command.type) {
    case 'expand_folder': {
      const { path } = command
      if ((await requireEntry(path)).kind !== 'directory') throw new Error(`${label(path)} is a file: use open_file`)
      await project.expandTo(path)
      if (!useProjectStore.getState().expanded[path]) await project.toggleFolder(path)
      useProjectStore.getState().focus(path)
      await pause()
      return describeFolder(path)
    }

    case 'collapse_folder': {
      const { path } = command
      if ((await requireEntry(path)).kind !== 'directory') throw new Error(`${label(path)} is a file`)
      if (useProjectStore.getState().expanded[path]) await project.toggleFolder(path)
      await pause()
      return `${label(path)} collapsed.`
    }

    case 'select_node': {
      const { path } = command
      await requireEntry(path)
      await project.reveal(path, { openFile: false })
      await pause()
      return `${label(path)} selected in the graph.`
    }

    case 'open_file': {
      const { path, line } = command
      if ((await requireEntry(path)).kind !== 'file') throw new Error(`${label(path)} is a folder: use expand_folder`)
      await project.reveal(path)
      if (line) useEditorStore.getState().goToLine(path, line)
      await pause()
      return `${path} opened in the editor${line ? ` at line ${line}` : ''}.`
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
