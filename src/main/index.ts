import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { statSync } from 'node:fs'
import path from 'node:path'
import {
  IPC,
  type IdeCommand,
  type Language,
  type ProjectIndex,
  type ProjectInfo,
  type TerminalCreateOptions,
  type UnsavedChoice
} from '../shared/ipc'
import { claudeLaunchSpec, prepareClaudeConfig, removeClaudeConfig, translateHook } from './claudeCode'
import { buildIndex, listDir, readFileContent, resolveInside, writeFileContent } from './fileSystem'
import { setLanguage, t } from './i18n'
import { IdeMcpServer } from './ideMcp'
import { TerminalManager } from './terminals'
import { ProjectWatcher } from './watcher'

let mainWindow: BrowserWindow | null = null

/** Raíz del proyecto abierto. Solo el main la conoce; el renderer trabaja con rutas relativas. */
let projectRoot: string | null = null

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

const terminals = new TerminalManager({
  data: (id, data) => sendToRenderer(IPC.terminalData, id, data),
  exit: (id, exitCode) => sendToRenderer(IPC.terminalExit, id, exitCode)
})

const watcher = new ProjectWatcher((changes) => sendToRenderer(IPC.fsChanges, changes))

const ideMcp = new IdeMcpServer(runIdeCommand, (payload) => {
  // Hooks de Claude Code: el renderer resalta lo que lee/edita y sabe si está trabajando.
  void translateHook(payload, projectRoot).then((events) => {
    for (const event of events) sendToRenderer(IPC.claudeEvent, event)
  })
})

// --- Acciones de Claude sobre la interfaz: el main las reenvía al renderer y espera respuesta ---

const COMMAND_TIMEOUT_MS = 15_000
let nextCommandId = 1
const pendingCommands = new Map<
  number,
  { resolve: (text: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
>()

/** Claude suele usar rutas absolutas o "./x": las pasamos a relativas a la raíz. */
function toProjectPath(root: string, input: string): string {
  const cleaned = input.trim()
  if (cleaned === '' || cleaned === '.' || cleaned === './') return ''
  const rel = path.relative(root, path.resolve(root, cleaned))
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(t('error.outsideProject', { path: input }))
  }
  return rel.split(path.sep).join('/')
}

function runIdeCommand(command: IdeCommand): Promise<string> {
  const root = requireRoot()
  const normalized = 'path' in command ? { ...command, path: toProjectPath(root, command.path) } : command
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.reject(new Error(t('error.noWindow')))
  const id = nextCommandId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id)
      reject(new Error(t('error.uiTimeout')))
    }, COMMAND_TIMEOUT_MS)
    pendingCommands.set(id, { resolve, reject, timer })
    sendToRenderer(IPC.ideCommand, id, normalized)
  })
}

function requireRoot(): string {
  if (!projectRoot) throw new Error(t('error.noProject'))
  return projectRoot
}

function openProject(rootPath: string): ProjectInfo {
  // Las terminales (Claude incluido) pertenecen al proyecto anterior.
  terminals.killAll()
  projectRoot = rootPath
  watcher.start(rootPath)
  return { rootPath, name: path.basename(rootPath) || rootPath }
}

/** Primera carpeta pasada por línea de comandos (`ide-node <carpeta>`, o `npm run dev -- -- <carpeta>`). */
function folderFromArgs(): string | null {
  // En desarrollo argv es [electron, ".", ...args]; empaquetada es [app, ...args].
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((arg) => !arg.startsWith('-'))
  for (const arg of args) {
    const abs = path.resolve(arg)
    try {
      if (statSync(abs).isDirectory()) return abs
    } catch {
      // no existe: probamos el siguiente
    }
  }
  return null
}

function registerIpc(): void {
  ipcMain.handle(IPC.initialProject, (): ProjectInfo | null => {
    const folder = folderFromArgs()
    return folder ? openProject(folder) : null
  })

  ipcMain.handle(IPC.openFolder, async (event): Promise<ProjectInfo | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: t('dialog.openFolder'), properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const selected = result.filePaths[0]
    if (result.canceled || !selected) return null
    return openProject(selected)
  })

  ipcMain.handle(IPC.listDir, (_event, relPath: string) => listDir(requireRoot(), relPath))

  ipcMain.handle(IPC.buildIndex, async (): Promise<ProjectIndex> => {
    // Capturamos la raíz al empezar: si el usuario abre otra carpeta mientras
    // tanto, el renderer descarta este resultado comparando rootPath.
    const root = requireRoot()
    return { rootPath: root, ...(await buildIndex(root)) }
  })

  ipcMain.handle(IPC.readFile, (_event, relPath: string) => readFileContent(requireRoot(), relPath))

  ipcMain.handle(IPC.writeFile, (_event, relPath: string, content: string) =>
    writeFileContent(requireRoot(), relPath, content)
  )

  ipcMain.handle(IPC.openPath, (_event, relPath: string) => shell.openPath(resolveInside(requireRoot(), relPath)))

  ipcMain.handle(IPC.revealPath, (_event, relPath: string) => {
    shell.showItemInFolder(resolveInside(requireRoot(), relPath))
  })

  ipcMain.handle(IPC.confirmUnsaved, async (event, paths: string[]): Promise<UnsavedChoice> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'warning' as const,
      buttons: [t('dialog.unsaved.save'), t('dialog.unsaved.discard'), t('dialog.unsaved.cancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message:
        paths.length === 1
          ? t('dialog.unsaved.one', { path: paths[0] })
          : t('dialog.unsaved.many', { count: paths.length }),
      detail: (paths.length > 1 ? paths.join('\n') + '\n\n' : '') + t('dialog.unsaved.detail')
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
  })

  ipcMain.on(IPC.flushStorage, (event) => event.sender.session.flushStorageData())
  ipcMain.on(IPC.setLanguage, (_event, language: Language) => {
    setLanguage(language)
    buildMenu()
  })

  ipcMain.on(IPC.ideCommandResult, (_event, id: number, ok: boolean, text: string) => {
    const pending = pendingCommands.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingCommands.delete(id)
    if (ok) pending.resolve(String(text))
    else pending.reject(new Error(String(text)))
  })

  ipcMain.handle(IPC.terminalCreate, (_event, options: TerminalCreateOptions) =>
    terminals.create(requireRoot(), options, options.claude ? claudeLaunchSpec() : undefined)
  )
  ipcMain.on(IPC.terminalWrite, (_event, id: number, data: string) => {
    if (typeof data === 'string') terminals.write(id, data)
  })
  ipcMain.on(IPC.terminalResize, (_event, id: number, cols: number, rows: number) => terminals.resize(id, cols, rows))
  ipcMain.handle(IPC.terminalKill, (_event, id: number) => terminals.kill(id))
}

/**
 * Menú mínimo: sin el Ctrl+W por defecto (cerraría la ventana; aquí cierra la pestaña del editor)
 * ni los roles de zoom (Ctrl +/-/0 los gestiona el renderer, que además recuerda el nivel).
 */
function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      {
        label: t('menu.view'),
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      }
    ])
  )
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    show: false,
    backgroundColor: '#1f1e1d',
    autoHideMenuBar: true,
    title: 'IDE Node',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Con la ventana tapada, Chromium congela requestAnimationFrame: los movimientos de cámara
      // que provocan Claude, los scripts o el watcher se quedarían a medias y se reproducirían
      // de golpe al volver. La app no tiene animaciones continuas, así que el coste es mínimo.
      backgroundThrottling: false
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // El renderer bloquea la descarga (beforeunload) si hay archivos sin guardar.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [t('dialog.leave.discard'), t('dialog.leave.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: t('dialog.leave.message'),
      detail: t('dialog.leave.detail')
    })
    if (choice === 0) event.preventDefault() // preventDefault = ignorar el bloqueo y continuar
  })

  win.on('closed', () => {
    mainWindow = null
    terminals.killAll()
    watcher.stop()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  buildMenu()
  registerIpc()
  await ideMcp.start()
  await prepareClaudeConfig(
    // Una carpeta por instancia: dos ventanas de la app (p. ej. dev y compilada) no se pisan el token.
    path.join(app.getPath('userData'), 'claude-code', String(process.pid)),
    ideMcp.mcpConfig(),
    ideMcp.hookUrl(),
    ideMcp.authToken
  )
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  terminals.killAll()
  ideMcp.stop()
  removeClaudeConfig()
  watcher.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
