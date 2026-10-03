import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo, type CSSProperties } from 'react'
import { colorForFile, extensionOf } from '../lib/fileColors'
import type { ClaudeFileAccess } from '../../../shared/ipc'
import { useClaudeStore } from '../stores/claudeStore'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import type { FileFlowNode, FolderFlowNode, MoreFlowNode } from './buildGraph'
import { useT } from '../i18n'
import { classes } from '../lib/classes'

/** Acceso más fuerte de Claude a algún archivo dentro de `folder` ('edit' gana a 'read'). */
function touchedInside(touched: Record<string, ClaudeFileAccess>, folder: string): ClaudeFileAccess | null {
  const prefix = folder === '' ? '' : folder + '/'
  let result: ClaudeFileAccess | null = null
  for (const [path, access] of Object.entries(touched)) {
    if (!path.startsWith(prefix)) continue
    if (access === 'edit') return 'edit'
    result = 'read'
  }
  return result
}

/** Los handles solo sirven para anclar las aristas; no se pueden crear conexiones. */
function Handles({ source = true }: { source?: boolean }) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {source && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </>
  )
}

export const FolderNode = memo(function FolderNode({ data }: NodeProps<FolderFlowNode>) {
  const selected = useProjectStore((s) => s.selected === data.path)
  // Con la carpeta abierta ya se ven sus archivos; cerrada, avisamos de que Claude tocó algo dentro.
  const claudeInside = useClaudeStore((s) => (data.expanded ? null : touchedInside(s.touched, data.path)))
  const t = useT()
  return (
    <div
      className={classes(
        'node',
        'node-folder',
        data.isRoot && 'node-root',
        data.heavy && 'node-heavy',
        selected && 'node-selected'
      )}
      title={data.path || data.name}
    >
      <Handles />
      <span className="node-chevron">{data.expanded ? '▾' : '▸'}</span>
      <span className="node-name">{data.name}</span>
      {claudeInside && (
        <span className={`node-claude-dot ${claudeInside}`} title={t('node.claudeInside')}>
          ●
        </span>
      )}
      {data.childCount !== null && <span className="node-badge">{data.childCount}</span>}
    </div>
  )
})

export const FileNode = memo(function FileNode({ data }: NodeProps<FileFlowNode>) {
  const selected = useProjectStore((s) => s.selected === data.path)
  const dirty = useEditorStore((s) => s.dirty[data.path] === true)
  const claude = useClaudeStore((s) => s.touched[data.path])
  const t = useT()
  const color = colorForFile(data.name)
  return (
    <div
      className={classes('node', 'node-file', selected && 'node-selected', claude && `node-claude-${claude}`)}
      // --file-color: de lejos (zoom semántico) el archivo se pinta entero de su color.
      style={{ borderLeftColor: color, '--file-color': color } as CSSProperties}
      title={data.path}
    >
      <Handles source={false} />
      <span className="node-name">{data.name}</span>
      {dirty && <span className="node-dirty" title={t('editor.unsaved')}>●</span>}
      <span className="node-ext" style={{ color }}>
        {extensionOf(data.name)}
      </span>
    </div>
  )
})

export const MoreNode = memo(function MoreNode({ data }: NodeProps<MoreFlowNode>) {
  const t = useT()
  return (
    <div className="node node-more" title={t('node.moreTitle')}>
      <Handles source={false} />
      <span className="node-name">{t('node.more', { count: data.hidden })}</span>
    </div>
  )
})

/** Fondo que agrupa una cuadrícula de hermanos, para que no parezcan hijos de la primera columna. */
const GridNode = memo(function GridNode() {
  return <div className="node-grid" />
})

export const nodeTypes = { folder: FolderNode, file: FileNode, more: MoreNode, grid: GridNode }
