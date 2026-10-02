/**
 * Claude Code dentro de la terminal de la app.
 *
 * El usuario usa el `claude` interactivo de siempre (con sus permisos, diffs, /usage...),
 * y la app le añade:
 * - el servidor MCP de la interfaz (ideMcp.ts), para que navegue por el grafo y abra archivos;
 * - unas instrucciones (`--append-system-prompt-file`) que le explican el IDE;
 * - hooks (`--settings`) que avisan a la app de lo que hace: así el grafo resalta lo que lee
 *   y edita, y la interfaz sabe si está trabajando o esperando al usuario.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  IDE_MCP_SERVER,
  IDE_TOOL_PREFIX,
  type ClaudeEvent,
  type ClaudeFileAccess,
  type ClaudeUsage
} from '../shared/ipc'
import { t } from './i18n'

/** Instrucciones añadidas al prompt de sistema (en inglés: las lee el modelo). */
const IDE_SYSTEM_PROMPT = `You are running inside IDE Node, a Claude-focused code editor. The user talks to you in the IDE's integrated terminal while looking at the project's file explorer, which is a graph of nodes.
The ${IDE_TOOL_PREFIX}* tools control that view: expand_folder (expands a folder, centers it and returns its contents), collapse_folder, select_node, open_file (opens a file in the user's editor, optionally at a line) and get_view (what the user is looking at right now).
When the user asks you to open, show, find or point out a file or folder, use those tools so they can follow the path in the graph: expand folders from the root down to the target and finish with open_file (files) or select_node (folders). If you don't know where it is, locate it first with Glob or Grep, then walk the path with expand_folder.
If the user refers to "this file" or to what they have open, call get_view.`

/**
 * Script del hook: reenvía a la app el JSON que Claude Code le pasa por stdin. Nunca debe
 * bloquear ni fallar (si la app no responde, Claude sigue igual).
 */
const HOOK_SCRIPT = `// IDE Node: reenvía los eventos de los hooks de Claude Code a la app.
const http = require('http')
const url = new URL(process.env.IDE_NODE_HOOK_URL || 'http://127.0.0.1:1/')
const done = () => process.exit(0)
setTimeout(done, 3000)
let body = ''
process.stdin.on('data', (chunk) => (body += chunk))
process.stdin.on('end', () => {
  const req = http.request(
    {
      host: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      timeout: 1500,
      headers: { Authorization: 'Bearer ' + (process.env.IDE_NODE_HOOK_TOKEN || ''), 'Content-Type': 'application/json' }
    },
    (res) => {
      res.resume()
      res.on('end', done)
    }
  )
  req.on('error', done)
  req.on('timeout', () => req.destroy())
  req.end(body)
})
`

/** Variables que enlazan con una sesión de Claude Code ya abierta (si la app se lanzó desde
 * una). Heredadas, el `claude` hijo se comportaría como una subsesión de esa. */
export const CLAUDE_SESSION_ENV = [
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

const READ_TOOLS = new Set(['Read'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

export interface LaunchSpec {
  file: string
  args: string | string[]
  /** Variables extra para el proceso (las heredan los hooks). */
  env: Record<string, string>
}

let configDir: string | null = null
let hookEnv: Record<string, string> = {}

/** Escribe los archivos que se le pasan a `claude`. Se regeneran en cada arranque de la app. */
export async function prepareClaudeConfig(dir: string, mcpConfig: string, hookUrl: string, token: string): Promise<void> {
  removeStaleConfigs(path.dirname(dir))
  await mkdir(dir, { recursive: true })
  const hookScript = path.join(dir, 'hook.js')
  await writeFile(hookScript, HOOK_SCRIPT)
  // Barras normales: el comando lo ejecuta la shell que use Claude Code (bash, cmd o PowerShell).
  const hook = [{ type: 'command', command: `node "${hookScript.split(path.sep).join('/')}"`, timeout: 5 }]
  const settings = {
    hooks: {
      UserPromptSubmit: [{ hooks: hook }],
      PreToolUse: [{ matcher: '*', hooks: hook }],
      PostToolUse: [{ matcher: '*', hooks: hook }],
      Notification: [{ hooks: hook }],
      Stop: [{ hooks: hook }]
    }
  }
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2))
  await writeFile(path.join(dir, 'mcp.json'), mcpConfig)
  await writeFile(path.join(dir, 'system-prompt.md'), IDE_SYSTEM_PROMPT)
  configDir = dir
  hookEnv = { IDE_NODE_HOOK_URL: hookUrl, IDE_NODE_HOOK_TOKEN: token }
}

/** Borra la configuración (contiene el token del servidor local). Síncrono: se llama al salir. */
export function removeClaudeConfig(): void {
  if (configDir) rmSync(configDir, { recursive: true, force: true })
}

/** Carpetas de instancias que ya no existen (la app se cerró de golpe y no pudo borrarlas). */
function removeStaleConfigs(parent: string): void {
  let names: string[]
  try {
    names = readdirSync(parent)
  } catch {
    return // primera vez
  }
  for (const name of names) {
    const pid = Number(name)
    // Lo que no es la carpeta de una instancia viva sobra (incluidos restos de versiones anteriores).
    if (Number.isInteger(pid) && (pid === process.pid || isAlive(pid))) continue
    rmSync(path.join(parent, name), { recursive: true, force: true })
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0) // señal 0: solo comprueba que el proceso existe
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM' // existe, pero es de otro usuario
  }
}

function findClaude(): string | null {
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** Cómo lanzar `claude` en un pty. Lanza un error legible si no está instalado. */
export function claudeLaunchSpec(): LaunchSpec {
  if (!configDir) throw new Error(t('claude.notFound'))
  const exe = findClaude()
  if (!exe) throw new Error(t('claude.notFound'))
  const file = (name: string): string => path.join(configDir!, name)
  const args = [
    '--mcp-config',
    file('mcp.json'),
    // Navegar por la interfaz no debe pedir permiso a cada paso.
    '--allowedTools',
    `mcp__${IDE_MCP_SERVER}`,
    '--append-system-prompt-file',
    file('system-prompt.md'),
    '--settings',
    file('settings.json')
  ]
  if (/\.(cmd|bat)$/i.test(exe)) {
    // Instalación vía npm: un .cmd solo se puede ejecutar a través de cmd.exe.
    const quoted = [exe, ...args].map((a) => `"${a}"`).join(' ')
    return { file: process.env.COMSPEC || 'cmd.exe', args: `/d /s /c "${quoted}"`, env: hookEnv }
  }
  return { file: exe, args, env: hookEnv }
}

/** Traduce el JSON de un hook a eventos para el renderer. */
export async function translateHook(payload: Record<string, unknown>, root: string | null): Promise<ClaudeEvent[]> {
  switch (payload.hook_event_name) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return [{ type: 'working' }]

    case 'PreToolUse': {
      const name = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool'
      const input = (payload.tool_input ?? {}) as Record<string, unknown>
      return [{ type: 'working' }, describeTool(name, input, root)]
    }

    case 'Notification':
      return [{ type: 'attention', message: typeof payload.message === 'string' ? payload.message : '' }]

    case 'Stop': {
      const usage = await usageFromTranscript(payload.transcript_path)
      return usage ? [{ type: 'idle' }, usage] : [{ type: 'idle' }]
    }

    default:
      return []
  }
}

function describeTool(name: string, input: Record<string, unknown>, root: string | null): ClaudeEvent {
  const filePath =
    stringField(input, 'file_path') ??
    stringField(input, 'notebook_path') ??
    (name.startsWith(IDE_TOOL_PREFIX) ? stringField(input, 'path') : null)
  const relative = filePath !== null && root ? relativeToRoot(root, filePath) : null
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

/**
 * Uso de la conversación leído de la transcripción de Claude Code (JSONL): tokens de todos los
 * mensajes del agente principal y contexto de la última llamada.
 */
async function usageFromTranscript(transcriptPath: unknown): Promise<ClaudeEvent | null> {
  // Solo transcripciones de Claude Code: el valor llega por una petición local autenticada,
  // pero no hay motivo para leer otra cosa.
  if (typeof transcriptPath !== 'string' || !transcriptPath.endsWith('.jsonl') || !transcriptPath.includes('.claude')) {
    return null
  }
  let text: string
  try {
    text = await readFile(transcriptPath, 'utf8')
  } catch {
    return null
  }

  // Un mismo mensaje puede aparecer en varias líneas (streaming): nos quedamos con la última.
  const messages = new Map<string, { model: string | null; usage: Record<string, unknown> }>()
  for (const line of text.split('\n')) {
    if (!line.includes('"assistant"')) continue
    try {
      const entry = JSON.parse(line) as {
        type?: string
        isSidechain?: boolean
        message?: { id?: string; model?: string; usage?: Record<string, unknown> }
      }
      if (entry.type !== 'assistant' || entry.isSidechain || !entry.message?.usage || !entry.message.id) continue
      messages.delete(entry.message.id) // reinsertar para que el orden sea el de la última aparición
      messages.set(entry.message.id, { model: entry.message.model ?? null, usage: entry.message.usage })
    } catch {
      // línea incompleta: se está escribiendo
    }
  }
  if (messages.size === 0) return null

  const usage: ClaudeUsage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
  for (const { usage: u } of messages.values()) {
    usage.inputTokens += num(u.input_tokens)
    usage.cacheReadTokens += num(u.cache_read_input_tokens)
    usage.cacheWriteTokens += num(u.cache_creation_input_tokens)
    usage.outputTokens += num(u.output_tokens)
  }
  const last = [...messages.values()].at(-1)!
  const contextTokens =
    num(last.usage.input_tokens) + num(last.usage.cache_read_input_tokens) + num(last.usage.cache_creation_input_tokens)
  return { type: 'usage', model: last.model, contextTokens, contextWindow: contextWindowOf(last.model), usage }
}

/** Ventana de contexto por familia (la transcripción no la incluye). Desconocida: null. */
function contextWindowOf(model: string | null): number | null {
  if (!model) return null
  if (/haiku/.test(model)) return 200_000
  if (/(opus|sonnet|fable|mythos)-(4-[6-9]|[5-9])/.test(model)) return 1_000_000
  return null
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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
