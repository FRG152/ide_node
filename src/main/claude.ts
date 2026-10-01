import { execFile, spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import { IDE_TOOL_PREFIX, type ClaudeEvent, type ClaudeFileAccess, type UsageWindow } from '../shared/ipc'
import { t } from './i18n'

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

/** Instrucciones añadidas al prompt de sistema de Claude Code (en inglés: las lee el modelo). */
export const IDE_SYSTEM_PROMPT = `You are running inside IDE Node, a Claude-focused code editor whose file explorer is a graph of nodes that the user sees on screen while talking to you.
The ${IDE_TOOL_PREFIX}* tools control that view: expand_folder (expands a folder, centers it and returns its contents), collapse_folder, select_node, open_file (opens a file in the user's editor, optionally at a line) and get_view (what the user is looking at right now).
When the user asks you to open, show, find or point out a file or folder, use those tools so they can follow the path in the graph: expand folders from the root down to the target and finish with open_file (files) or select_node (folders). If you don't know where it is, locate it first with Glob or Grep, then walk the path with expand_folder.
If the user refers to "this file" or to what they have open, call get_view.
Reply in the language the user writes in.`

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
            ? t('claude.notFound')
            : err.message
      })
    })
    proc.on('close', (code) => {
      if (this.proc === proc) this.proc = null
      // Si ya llegó el resultado, esto no emite nada (ver `finished`).
      emit({
        type: 'error',
        message: this.cancelled.has(proc)
          ? t('claude.stopped')
          : stderr.trim() || t('claude.noResponse', { code: String(code) })
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
        ? [{ type: 'session', sessionId: message.session_id, model: typeof message.model === 'string' ? message.model : null }]
        : []

    case 'stream_event': {
      // Solo el agente principal: el texto de los subagentes no es la respuesta, y su
      // contexto es otro.
      if (message.parent_tool_use_id) return []
      const event = message.event as {
        type?: string
        delta?: { type?: string; text?: string }
        message?: { usage?: Record<string, unknown> }
      }
      if (event.type === 'message_start' && event.message?.usage) {
        // Lo que ocupa el contexto en esta llamada: la entrada completa, cacheada o no.
        const usage = event.message.usage
        return [{ type: 'context', tokens: num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens) }]
      }
      return event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text
        ? [{ type: 'text', text: event.delta.text }]
        : []
    }

    case 'rate_limit_event': {
      const windows = (message.rate_limit_info as { unifiedWindows?: Record<string, unknown> } | undefined)?.unifiedWindows
      if (!windows) return []
      return [{ type: 'limits', fiveHour: usageWindow(windows.five_hour), sevenDay: usageWindow(windows.seven_day) }]
    }

    case 'assistant': {
      const content = (message.message as { content?: unknown[] })?.content ?? []
      return content
        .filter((block): block is { type: 'tool_use' } & ToolUse => (block as { type?: string }).type === 'tool_use')
        .map((block) => describeTool(block, root))
    }

    case 'result': {
      const denials = Array.isArray(message.permission_denials) ? message.permission_denials : []
      const usage = (message.usage ?? {}) as Record<string, unknown>
      const models = Object.values((message.modelUsage ?? {}) as Record<string, { contextWindow?: unknown }>)
      const contextWindow = models.map((m) => num(m.contextWindow)).find((n) => n > 0) ?? null
      return [
        {
          type: 'usage',
          usage: {
            inputTokens: num(usage.input_tokens),
            cacheReadTokens: num(usage.cache_read_input_tokens),
            cacheWriteTokens: num(usage.cache_creation_input_tokens),
            outputTokens: num(usage.output_tokens),
            costUsd: num(message.total_cost_usd)
          },
          contextWindow
        },
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
  // La raíz llega como detalle vacío: el renderer la muestra traducida.
  if (filePath !== null) detail = relative ?? (filePath.trim() === '' || filePath === '.' ? '' : filePath)
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

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageWindow(value: unknown): UsageWindow | null {
  const w = value as { utilization?: unknown; resetsAt?: unknown } | undefined
  return w && typeof w.utilization === 'number' ? { utilization: w.utilization, resetsAt: num(w.resetsAt) } : null
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
