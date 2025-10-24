# Auto-update via GitHub Actions (Electron + Vite)

This document shows a complete, copy-ready approach to add auto-updates to an Electron + Vite app using GitHub Actions, `electron-builder`, and `electron-updater`.

It includes:

- high-level requirements and secrets
- code snippets for `main` / `preload` / `renderer`
- a GitHub Actions workflow to build and publish releases
- testing and platform caveats

---

## What I'll do next

- Explain required high-level changes and secrets.
- Provide exact files/snippets to add or edit:
  - `package.json` build/publish settings and scripts
  - `src/main/index.ts` (autoUpdater wiring)
  - `src/preload/index.ts` (IPC bridge)
  - `src/renderer/src/...` (UI to show updates — sample)
  - `.github/workflows/release.yml` (GitHub Actions workflow to build + publish)
- Give step-by-step commands to run locally and how to test.
- Note platform/signing caveats and edge cases.

## Quick contract (what success looks like)

- Input: push to `main` (or chosen branch) in GitHub.
- Output: GitHub Actions builds installers/artifacts and publishes a GitHub Release containing update metadata; the running app detects the new release, notifies the user, and lets the user install the update.
- Error modes: missing `GH_TOKEN`, macOS code-signing missing, build failures. The workflow will fail with clear logs.

## High-level overview

- Use `electron-builder` to produce distributables and publish metadata (e.g. `latest.yml`) to GitHub Releases.
- Use `electron-updater` (main process) to check for updates and notify the renderer via the preload IPC bridge.
- Use a GitHub Actions workflow that runs on push to `main` to build and publish artifacts. The workflow uses a `GH_TOKEN` secret so `electron-builder` can push to Releases.

## Required repo secret

Add a repository secret named `GH_TOKEN` with a token that has `repo` access. In many cases you can use Actions' `GITHUB_TOKEN` directly by exposing it to the step (see workflow example), otherwise create a personal access token with `repo` scope.

## Files to add / edit

### 1) `package.json` — publish config & scripts

Add or update a `build` config and scripts. If you use `electron-builder.yml`, keep that and ensure the `publish` block points to GitHub. Example (merge into `package.json` or into `electron-builder.yml`):

```json
"build": {
  "appId": "com.yourcompany.yourapp",
  "productName": "YourApp",
  "files": ["build/**/*","dist/**/*","src/**/*","package.json"],
  "directories": { "buildResources": "resources" },
  "publish": [
    { "provider": "github", "owner": "YOUR_GITHUB_USERNAME_OR_ORG", "repo": "REPO_NAME" }
  ]
},
"scripts": {
  "postinstall": "electron-builder install-app-deps",
  "build": "vite build && tsc -p tsconfig.node.json",
  "dist": "electron-builder --publish always",
  "dist:ci": "electron-builder --publish always"
}
```

Replace `YOUR_GITHUB_USERNAME_OR_ORG` and `REPO_NAME` accordingly.

### 2) `src/main/index.ts` — wiring `electron-updater`

Install the dependency:

```powershell
npm install -S electron-updater
```

Add update handling code near `app.whenReady()` or after `createWindow()`:

```ts
// src/main/index.ts
import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'info'
log.info('App starting...')

app.on('ready', () => {
  // downloads updates in the background and notifies
  autoUpdater.checkForUpdatesAndNotify()
})

autoUpdater.on('checking-for-update', () => log.info('Checking for updates...'))
autoUpdater.on('update-available', (info) => log.info('Update available:', info))
autoUpdater.on('update-not-available', (info) => log.info('Update not available:', info))
autoUpdater.on('download-progress', (progressObj) => log.info('Download progress', progressObj))

autoUpdater.on('update-downloaded', (info) => {
  log.info('Update downloaded:', info)
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Install and Restart', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: 'A new version has been downloaded',
    detail: 'Do you want to install the update now? The app will restart.'
  })

  if (choice === 0) autoUpdater.quitAndInstall(false, true)
})
```

Notes: forward these events to your renderer via IPC (see the `preload` section).

### 3) `src/preload/index.ts` — expose update IPC to renderer

If you already use `contextBridge`, add a small `electronUpdater` API:

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronUpdater', {
  on: (channel: string, listener: (data: any) => void) => {
    const allowed = [
      'update-available',
      'update-not-available',
      'download-progress',
      'update-downloaded',
      'checking-for-update'
    ]
    if (!allowed.includes(channel)) return
    ipcRenderer.on(channel, (_e, data) => listener(data))
  },
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update')
})
```

And in `main` add forwarding handlers:

```ts
import { ipcMain, BrowserWindow } from 'electron'

function sendToAllWindows(channel: string, payload?: any) {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload))
}

autoUpdater.on('checking-for-update', () => sendToAllWindows('checking-for-update'))
autoUpdater.on('update-available', (info) => sendToAllWindows('update-available', info))
autoUpdater.on('update-not-available', (info) => sendToAllWindows('update-not-available', info))
autoUpdater.on('download-progress', (p) => sendToAllWindows('download-progress', p))
autoUpdater.on('update-downloaded', (info) => sendToAllWindows('update-downloaded', info))

ipcMain.handle('check-for-updates', async () => autoUpdater.checkForUpdates())
ipcMain.handle('install-update', async () => autoUpdater.quitAndInstall(false, true))
```

### 4) Renderer UI — `src/renderer/src/components/Versions.tsx`

Minimal React example that listens for update events:

```tsx
import React, { useEffect, useState } from 'react'

declare global {
  interface Window {
    electronUpdater?: any
  }
}

export default function Versions() {
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const eu = window.electronUpdater
    if (!eu) return
    eu.on('checking-for-update', () => setStatus('checking'))
    eu.on('update-available', () => setStatus('update-available'))
    eu.on('update-not-available', () => setStatus('no-update'))
    eu.on('download-progress', (p: any) => {
      setStatus('downloading')
      setProgress(Math.round(p.percent))
    })
    eu.on('update-downloaded', () => setStatus('downloaded'))
  }, [])

  return (
    <div>
      <h3>Auto Update</h3>
      <div>Status: {status}</div>
      {status === 'downloading' && <div>Progress: {progress}%</div>}
      <div style={{ marginTop: 8 }}>
        <button onClick={() => window.electronUpdater?.checkForUpdates()}>Check for updates</button>
        {status === 'downloaded' && (
          <button onClick={() => window.electronUpdater?.installUpdate()}>Install update</button>
        )}
      </div>
    </div>
  )
}
```

### 5) GitHub Actions workflow — `.github/workflows/release.yml`

Create a workflow that builds and publishes on push to `main`. Example:

```yaml
name: Build and Publish Electron App

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18.x]
    timeout-minutes: 120

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix['node-version'] }}
          cache: 'npm'
      - name: Install dependencies
        run: |
          npm ci
      - name: Build renderer + main
        run: |
          npm run build
      - name: Build and publish (electron-builder)
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
        run: |
          npx electron-builder --publish always
```

Notes:

- The matrix builds on 3 OSes; narrow it if you only need a single-platform publish.
- `GH_TOKEN` must be present in repository secrets.

## Testing locally before pushing

```powershell
npm ci
npm run build
npx electron-builder --publish never
```

This produces installers in `dist/`. To test updates you can manually upload one release and then publish another; CI publishing is recommended for real update testing.

## How update discovery works

- `electron-builder` uploads `latest.yml`/`latest-mac.json` and artifacts to GitHub Releases.
- `electron-updater` checks releases, downloads updates, and emits `update-downloaded`.

## Edge cases & caveats

- Missing `GH_TOKEN` or insufficient permissions → CI publishing fails.
- macOS signing/notarization requires Apple credentials for production-signed builds.
- Make sure `version` in `package.json` is bumped for each release (or use tags/automation).

## Minimal verification checklist

- Locally: `npm run build` succeeds.
- Locally: `npx electron-builder --publish never` produces installers.
- On GitHub: push to `main` and confirm Actions create a Release with artifacts and `latest.yml`.
- App: an older installed app should detect and install the new release.

## Small extras (optional)

- Install `electron-log` to capture updater logs:

```powershell
npm install -S electron-log
```

- Add unit tests for the IPC bridge (mock `window.electronUpdater`).

## Example quick commands (PowerShell)

```powershell
# install dependencies
npm ci

# build the app (renderer + main)
npm run build

# produce distributables locally (do not publish)
npx electron-builder --publish never

# OR to publish locally (set GH_TOKEN first):
$env:GH_TOKEN = 'your-token-here'; npx electron-builder --publish always
```

## Platform notes

- Windows: produces `.exe`/NSIS installers. Auto-updater works well.
- macOS: produces `.dmg`/`.zip`/`.pkg`. Signing/notarization is additional work.
- Linux: AppImage/dpkg/etc depending on config.

## What I provided

- Paste-ready code for the `package.json` build/scripts, `src/main/index.ts` wiring, `src/preload/index.ts` bridge, `src/renderer/src/components/Versions.tsx`, and `.github/workflows/release.yml`.

## Next steps for you

1. Merge the snippets into your files (or ask me to create patches).
2. Install `electron-updater` and optionally `electron-log`.
3. Add `GH_TOKEN` to your repo secrets.
4. Commit and push to `main` and verify the Actions run and Release is created.
5. Install a previous build and publish a new one to validate in-app auto-update behavior.

If you'd like, I can generate exact patch edits for the files in your repo (tell me whether to modify `package.json` or `electron-builder.yml` for publish settings).
