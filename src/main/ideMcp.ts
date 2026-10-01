import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { IDE_MCP_SERVER, type IdeCommand } from '../shared/ipc'

const pathArg = z
  .string()
  .describe('Path relative to the project root, using "/" (the root is ""). An absolute path inside the project also works.')

/**
 * Servidor MCP local con herramientas para manejar la interfaz de la app (el grafo y el
 * editor). Claude Code se conecta a él por HTTP; cada herramienta se ejecuta en el renderer.
 */
export class IdeMcpServer {
  private http: Server | null = null
  private port = 0
  /** Solo quien conozca el token (el `claude` que lanzamos) puede usar el servidor. */
  private readonly token = randomBytes(24).toString('hex')

  constructor(private readonly runCommand: (command: IdeCommand) => Promise<string>) {}

  async start(): Promise<void> {
    const http = createServer((req, res) => {
      if (req.url !== '/mcp' || req.headers.authorization !== `Bearer ${this.token}`) {
        res.writeHead(401).end()
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end() // sin stream SSE de servidor a cliente: no lo necesitamos
        return
      }
      // Modo sin estado: un servidor y un transporte por petición.
      const server = this.createMcpServer()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts: [`127.0.0.1:${this.port}`, `localhost:${this.port}`]
      })
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      server
        .connect(transport)
        .then(() => transport.handleRequest(req, res))
        .catch(() => {
          if (!res.headersSent) res.writeHead(500).end()
        })
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    this.http = http
    this.port = (http.address() as AddressInfo).port
  }

  stop(): void {
    this.http?.close()
    this.http = null
  }

  /** Valor para `claude --mcp-config`. */
  mcpConfig(): string {
    return JSON.stringify({
      mcpServers: {
        [IDE_MCP_SERVER]: {
          type: 'http',
          url: `http://127.0.0.1:${this.port}/mcp`,
          headers: { Authorization: `Bearer ${this.token}` }
        }
      }
    })
  }

  private createMcpServer(): McpServer {
    const server = new McpServer({ name: 'ide-node', version: '0.1.0' })
    const run = async (command: IdeCommand) => {
      try {
        return { content: [{ type: 'text' as const, text: await this.runCommand(command) }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true }
      }
    }

    server.registerTool(
      'expand_folder',
      {
        description:
          'Expands a folder in the graph the user sees on screen (and the folders containing it), centers it and returns its contents. Use it to walk through the project step by step.',
        inputSchema: { path: pathArg }
      },
      ({ path }) => run({ type: 'expand_folder', path })
    )
    server.registerTool(
      'collapse_folder',
      { description: 'Collapses a folder in the graph.', inputSchema: { path: pathArg } },
      ({ path }) => run({ type: 'collapse_folder', path })
    )
    server.registerTool(
      'select_node',
      {
        description: 'Selects and centers a file or folder in the graph, without opening it in the editor.',
        inputSchema: { path: pathArg }
      },
      ({ path }) => run({ type: 'select_node', path })
    )
    server.registerTool(
      'open_file',
      {
        description:
          "Opens a file in the user's editor (central window) and selects it in the graph. Optionally moves the cursor to a line.",
        inputSchema: { path: pathArg, line: z.number().int().positive().optional().describe('Line number (1-based)') }
      },
      ({ path, line }) => run({ type: 'open_file', path, line })
    )
    server.registerTool(
      'get_view',
      {
        description:
          'Describes what the user is looking at: selected node, file in the editor, minimized files and expanded folders.'
      },
      () => run({ type: 'get_view' })
    )
    return server
  }
}
