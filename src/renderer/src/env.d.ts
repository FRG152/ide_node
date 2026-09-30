import type { IdeApi } from '../../shared/ipc'

declare global {
  interface Window {
    api: IdeApi
  }
}

export {}
