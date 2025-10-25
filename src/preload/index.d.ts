import { ElectronAPI } from '@electron-toolkit/preload'

type UpdateEvent =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'update-error'

interface AppUpdaterApi {
  updates: {
    on(channel: UpdateEvent, listener: (payload: unknown) => void): void
    once(channel: UpdateEvent, listener: (payload: unknown) => void): void
    removeAllListeners(channel: UpdateEvent): void
  }
  getAppVersion(): Promise<string>
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  installUpdate(): Promise<unknown>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppUpdaterApi
  }
}
