import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { statSync } from 'node:fs'
import path from 'node:path'
import {
  IPC,
  type ProjectIndex,
  type ProjectInfo,
  type TerminalCreateOptions,
  type UnsavedChoice
} from '../shared/ipc'
import { buildIndex, listDir, readFileContent, resolveInside, writeFileContent } from './fileSystem'
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

function requireRoot(): string {
  if (!projectRoot) throw new Error('No hay ningún proyecto abierto')
  return projectRoot
}

function openProject(rootPath: string): ProjectInfo {
  // Las terminales pertenecen al proyecto anterior.
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
    const options = { title: 'Abrir carpeta de proyecto', properties: ['openDirectory' as const] }
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
      buttons: ['Guardar', 'No guardar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message:
        paths.length === 1
          ? `¿Quieres guardar los cambios de ${paths[0]}?`
          : `¿Quieres guardar los cambios de ${paths.length} archivos?`,
      detail: (paths.length > 1 ? paths.join('\n') + '\n\n' : '') + 'Si no los guardas, se perderán.'
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
  })

  ipcMain.handle(IPC.terminalCreate, (_event, options: TerminalCreateOptions) =>
    terminals.create(requireRoot(), options)
  )
  ipcMain.on(IPC.terminalWrite, (_event, id: number, data: string) => {
    if (typeof data === 'string') terminals.write(id, data)
  })
  ipcMain.on(IPC.terminalResize, (_event, id: number, cols: number, rows: number) => terminals.resize(id, cols, rows))
  ipcMain.handle(IPC.terminalKill, (_event, id: number) => terminals.kill(id))
}

/** Menú mínimo: sin el Ctrl+W por defecto (cerraría la ventana; aquí cierra la pestaña del editor). */
function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      {
        label: 'Ver',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
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
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    title: 'IDE Node',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // El renderer bloquea la descarga (beforeunload) si hay archivos sin guardar.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Descartar cambios', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      message: 'Hay archivos con cambios sin guardar.',
      detail: 'Si continúas, se perderán.'
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

app.whenReady().then(() => {
  buildMenu()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  terminals.killAll()
  watcher.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
