import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron'
import { IPC, type IdeApi } from '../shared/ipc'

/** Suscripción a un evento main -> renderer; devuelve la función para desuscribirse. */
function subscribe<Args extends unknown[]>(channel: string, listener: (...args: Args) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, ...args: unknown[]): void => listener(...(args as Args))
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const api: IdeApi = {
  initialProject: () => ipcRenderer.invoke(IPC.initialProject),
  openFolder: () => ipcRenderer.invoke(IPC.openFolder),
  listDir: (path) => ipcRenderer.invoke(IPC.listDir, path),
  buildIndex: () => ipcRenderer.invoke(IPC.buildIndex),
  readFile: (path) => ipcRenderer.invoke(IPC.readFile, path),
  writeFile: (path, content) => ipcRenderer.invoke(IPC.writeFile, path, content),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  revealPath: (path) => ipcRenderer.invoke(IPC.revealPath, path),
  setLanguage: (language) => ipcRenderer.send(IPC.setLanguage, language),
  setZoomLevel: (level) => webFrame.setZoomLevel(level),
  flushStorage: () => ipcRenderer.send(IPC.flushStorage),
  confirmUnsaved: (paths) => ipcRenderer.invoke(IPC.confirmUnsaved, paths),
  onFsChanges: (listener) => subscribe(IPC.fsChanges, listener),

  onClaudeEvent: (listener) => subscribe(IPC.claudeEvent, listener),

  onIdeCommand: (listener) => subscribe(IPC.ideCommand, listener),
  ideCommandResult: (id, ok, text) => ipcRenderer.send(IPC.ideCommandResult, id, ok, text),

  terminalCreate: (options) => ipcRenderer.invoke(IPC.terminalCreate, options),
  terminalWrite: (id, data) => ipcRenderer.send(IPC.terminalWrite, id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.send(IPC.terminalResize, id, cols, rows),
  terminalKill: (id) => ipcRenderer.invoke(IPC.terminalKill, id),
  onTerminalData: (listener) => subscribe(IPC.terminalData, listener),
  onTerminalExit: (listener) => subscribe(IPC.terminalExit, listener)
}

contextBridge.exposeInMainWorld('api', api)
