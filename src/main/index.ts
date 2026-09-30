import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { statSync } from 'node:fs'
import path from 'node:path'
import { IPC, type ProjectIndex, type ProjectInfo } from '../shared/ipc'
import { buildIndex, listDir, readFilePreview, resolveInside } from './fileSystem'

/** Raíz del proyecto abierto. Solo el main la conoce; el renderer trabaja con rutas relativas. */
let projectRoot: string | null = null

function requireRoot(): string {
  if (!projectRoot) throw new Error('No hay ningún proyecto abierto')
  return projectRoot
}

function openProject(rootPath: string): ProjectInfo {
  projectRoot = rootPath
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

  ipcMain.handle(IPC.readFile, (_event, relPath: string) => readFilePreview(requireRoot(), relPath))

  ipcMain.handle(IPC.openPath, (_event, relPath: string) => shell.openPath(resolveInside(requireRoot(), relPath)))

  ipcMain.handle(IPC.revealPath, (_event, relPath: string) => {
    shell.showItemInFolder(resolveInside(requireRoot(), relPath))
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
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

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
