import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { autoUpdater } from 'electron-updater'

let mainWindow: BrowserWindow | null = null

// Configure updater: let the UI control downloading
autoUpdater.autoDownload = false

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Wire auto-updater events to renderer
  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('checking-for-update')
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', info)
  })

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('update-not-available', info)
  })

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('download-progress', progressObj)
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-error', err == null ? 'unknown' : err.message)
  })

  // IPC handlers for renderer control and info
  ipcMain.handle('get-app-version', () => app.getVersion())

  ipcMain.handle('update-check', async () => {
    try {
      // In development (not packaged) electron-updater often won't contact
      // providers the same way as a packaged app. To make the UI testable in
      // dev, simulate updater events when app isn't packaged.
      if (!app.isPackaged) {
        // notify renderer we're checking
        mainWindow?.webContents.send('checking-for-update')
        // simulate a short delay then notify that an update is available
        setTimeout(() => {
          mainWindow?.webContents.send('update-available', {
            version: app.getVersion() + '-dev',
            releaseName: `dev-simulated-${app.getVersion()}`
          })
        }, 800)

        return { simulated: true }
      }

      return await autoUpdater.checkForUpdates()
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  ipcMain.handle('update-download', async () => {
    try {
      if (!app.isPackaged) {
        // Simulate download progress in dev
        let pct = 0
        const t = setInterval(() => {
          pct += Math.floor(Math.random() * 20) + 5
          if (pct >= 100) pct = 100
          mainWindow?.webContents.send('download-progress', { percent: pct })
          if (pct >= 100) {
            clearInterval(t)
            mainWindow?.webContents.send('update-downloaded', {
              version: app.getVersion() + '-dev'
            })
          }
        }, 300)

        return { simulated: true }
      }

      return await autoUpdater.downloadUpdate()
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  ipcMain.handle('update-install', () => {
    try {
      autoUpdater.quitAndInstall()
      return { ok: true }
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
