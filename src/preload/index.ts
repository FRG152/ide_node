import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type IdeApi } from '../shared/ipc'

const api: IdeApi = {
  initialProject: () => ipcRenderer.invoke(IPC.initialProject),
  openFolder: () => ipcRenderer.invoke(IPC.openFolder),
  listDir: (path) => ipcRenderer.invoke(IPC.listDir, path),
  buildIndex: () => ipcRenderer.invoke(IPC.buildIndex),
  readFile: (path) => ipcRenderer.invoke(IPC.readFile, path),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  revealPath: (path) => ipcRenderer.invoke(IPC.revealPath, path)
}

contextBridge.exposeInMainWorld('api', api)
