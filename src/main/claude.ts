import { execFile, spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import { IDE_TOOL_PREFIX, type ClaudeEvent, type ClaudeFileAccess } from '../shared/ipc'

/**
 * Claude Code en modo no interactivo (`claude -p`): usa la instalación y la cuenta del
 * usuario, sin API key propia.
 *
 * - acceptEdits: puede leer y editar archivos del proyecto sin preguntar.
 * - --permission-prompts none: lo que pediría permiso (ejecutar comandos...) se deniega
 *   automáticamente en lugar de quedarse esperando una respuesta que nadie puede dar.
 */
const BASE_ARGS = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode',
  'acceptEdits',
  '--permission-prompts',
  'none'
]

/** Variables que enlazan con una sesión de Claude Code ya abierta (si la app se lanzó desde
 * una). Heredadas, el `claude` hijo se comportaría como una subsesión de esa. */
const SESSION_ENV = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PID',
  'CLAUDE_EFFORT'
]

/** Instrucciones añadidas al prompt de sistema de Claude Code. */
export const IDE_SYSTEM_PROMPT = `Estás integrado en IDE Node, un editor de código cuyo explorador de archivos es un grafo de nodos que el usuario ve en pantalla mientras hablas con él.
Con las herramientas ${IDE_TOOL_PREFIX}* manejas esa vista: expand_folder (expande una carpeta, la centra y te devuelve su contenido), collapse_folder, select_node, open_file (abre un archivo en el editor del usuario, opcionalmente en una línea) y get_view (qué está viendo el usuario ahora).
Cuando el usuario te pida abrir, mostrar, buscar o enseñarle un archivo o carpeta, hazlo con esas herramientas para que vea el recorrido en el grafo: ve expandiendo carpetas desde la raíz hasta llegar y termina con open_file (archivos) o select_node (carpetas). Si no sabes dónde está, puedes localizarlo antes con Glob o Grep y luego recorrer el camino con expand_folder.
Si el usuario habla de "este archivo" o de lo que tiene abierto, usa get_view.`

const READ_TOOLS = new Set(['Read'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

interface ToolUse {
  name: string
  input: Record<string, unknown>
}

export class ClaudeRunner {
  private proc: ChildProcess | null = null
  private cancelled = new WeakSet<ChildProcess>()

  constructor(
    private readonly emit: (runId: number, event: ClaudeEvent) => void,
    /** Argumentos adicionales en cada ejecución (servidor MCP de la interfaz, etc.). */
    private readonly extraArgs: () => string[] = () => []
  ) {}

  run(runId: number, root: string, prompt: string, sessionId: string | null): void {
    this.cancel()
    const args = [...BASE_ARGS, ...this.extraArgs(), ...(sessionId ? ['--resume', sessionId] : [])]
    const proc = spawn('claude', args, { cwd: root, env: claudeEnv(), windowsHide: true })
    this.proc = proc

    let finished = false
    let stderr = ''
    const emit = (event: ClaudeEvent): void => {
      if (event.type === 'done' || event.type === 'error') {
        if (finished) return
        finished = true
      }
      this.emit(runId, event)
    }

    proc.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    proc.on('error', (err: NodeJS.ErrnoException) => {
      emit({
        type: 'error',
        message:
          err.code === 'ENOENT'
            ? 'No se encontró el comando "claude". Instala Claude Code y vuelve a abrir la app.'
            : err.message
      })
    })
    proc.on('close', (code) => {
      if (this.proc === proc) this.proc = null
      // Si ya llegó el resultado, esto no emite nada (ver `finished`).
      emit({
        type: 'error',
        message: this.cancelled.has(proc)
          ? 'Detenido.'
          : stderr.trim() || `Claude terminó sin respuesta (código ${code}).`
      })
    })

    readline.createInterface({ input: proc.stdout! }).on('line', (line) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(line)
      } catch {
        return // línea que no es JSON (avisos del CLI)
      }
      for (const event of translate(message, root)) emit(event)
    })

    // El prompt va por stdin: sin límites de longitud ni problemas de comillas en Windows.
    proc.stdin?.end(prompt)
  }

  cancel(): void {
    const proc = this.proc
    if (!proc?.pid) return
    this.proc = null
    this.cancelled.add(proc)
    // Claude puede haber lanzado subprocesos: matamos el árbol entero.
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {})
    } else {
      proc.kill('SIGTERM')
    }
  }
}

function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of SESSION_ENV) delete env[key]
  return env
}

/** Convierte un mensaje de `--output-format stream-json` en cero o más eventos para el renderer. */
function translate(message: Record<string, unknown>, root: string): ClaudeEvent[] {
  switch (message.type) {
    case 'system':
      return message.subtype === 'init' && typeof message.session_id === 'string'
        ? [{ type: 'session', sessionId: message.session_id }]
        : []

    case 'stream_event': {
      // Solo el texto del agente principal; el de los subagentes no es la respuesta.
      if (message.parent_tool_use_id) return []
      const event = message.event as { type?: string; delta?: { type?: string; text?: string } }
      return event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text
        ? [{ type: 'text', text: event.delta.text }]
        : []
    }

    case 'assistant': {
      const content = (message.message as { content?: unknown[] })?.content ?? []
      return content
        .filter((block): block is { type: 'tool_use' } & ToolUse => (block as { type?: string }).type === 'tool_use')
        .map((block) => describeTool(block, root))
    }

    case 'result': {
      const denials = Array.isArray(message.permission_denials) ? message.permission_denials : []
      return [
        {
          type: 'done',
          ok: message.subtype === 'success' && message.is_error !== true,
          result: typeof message.result === 'string' ? message.result : '',
          durationMs: typeof message.duration_ms === 'number' ? message.duration_ms : 0,
          denied: denials.map((d) => describeDenial(d as Record<string, unknown>))
        }
      ]
    }

    default:
      return []
  }
}

function describeTool({ name, input }: ToolUse, root: string): ClaudeEvent {
  const filePath =
    stringField(input, 'file_path') ??
    stringField(input, 'notebook_path') ??
    (name.startsWith(IDE_TOOL_PREFIX) ? stringField(input, 'path') : null)
  const relative = filePath ? relativeToRoot(root, filePath) : null
  const access: ClaudeFileAccess | null = READ_TOOLS.has(name) ? 'read' : EDIT_TOOLS.has(name) ? 'edit' : null

  let detail = ''
  if (filePath !== null) detail = relative ?? (filePath.trim() === '' || filePath === '.' ? '(raíz)' : filePath)
  else if (name === 'Bash' || name === 'PowerShell') detail = stringField(input, 'command') ?? ''
  else if (name === 'Grep' || name === 'Glob') detail = stringField(input, 'pattern') ?? ''
  else if (name === 'WebFetch') detail = stringField(input, 'url') ?? ''
  else if (name === 'WebSearch') detail = stringField(input, 'query') ?? ''
  else if (name === 'Task' || name === 'Agent') detail = stringField(input, 'description') ?? ''

  return { type: 'tool', name, detail, path: relative, access: relative ? access : null }
}

function describeDenial(denial: Record<string, unknown>): string {
  const name = stringField(denial, 'tool_name') ?? 'herramienta'
  const input = (denial.tool_input ?? {}) as Record<string, unknown>
  const command = stringField(input, 'command')
  return command ? `${name}: ${command}` : name
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

/** Ruta relativa al proyecto con "/", o null si el archivo está fuera de él. */
function relativeToRoot(root: string, filePath: string): string | null {
  const rel = path.relative(root, path.resolve(root, filePath))
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}
