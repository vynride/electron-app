import { useEffect, useState } from 'react'

function Versions(): React.JSX.Element {
  const [versions] = useState(window.electron.process.versions)

  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [availableVersion, setAvailableVersion] = useState<string | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [checking, setChecking] = useState(false)
  const [notAvailableMessage, setNotAvailableMessage] = useState<string | null>(null)

  useEffect(() => {
    // get installed app version
    const fetchVersion = async () => {
      // Try the exposed API first, then fall back to invoking ipc directly if available.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (window.api && typeof window.api.getAppVersion === 'function') {
            const v = await window.api.getAppVersion()
            if (v) return setAppVersion(v)
          }

          // Fallback: some preload setups expose electron.ipcRenderer
          // @ts-ignore - runtime check
          if ((window as any).electron?.ipcRenderer?.invoke) {
            // @ts-ignore
            const v = await (window as any).electron.ipcRenderer.invoke('get-app-version')
            if (v) return setAppVersion(v)
          }
        } catch (err) {
          // wait and retry
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      // if we couldn't get a version, leave as null
    }

    void fetchVersion()

    try {
      window.api.updates.on('checking-for-update', () => {
        setChecking(true)
        setNotAvailableMessage(null)
      })

      window.api.updates.on('update-available', (info) => {
        setChecking(false)
        setUpdateAvailable(true)
        const ver = (info as any)?.version ?? null
        setAvailableVersion(ver)
      })

      window.api.updates.on('update-not-available', () => {
        setChecking(false)
        setUpdateAvailable(false)
        setNotAvailableMessage('No updates are available')
      })

      window.api.updates.on('download-progress', (progress) => {
        const pct =
          (progress as any)?.percent ?? (typeof progress === 'number' ? progress : undefined)
        setDownloadProgress(typeof pct === 'number' ? Math.round(pct) : null)
      })

      window.api.updates.on('update-downloaded', (info) => {
        setDownloaded(true)
        setDownloadProgress(100)
        const ver = (info as any)?.version ?? null
        if (ver) setAvailableVersion(ver)
      })

      window.api.updates.on('update-error', (err) => {
        console.error('Update error:', err)
        setChecking(false)
      })

      // initial check (non-blocking)
      window.api.checkForUpdates().catch(() => {})
    } catch {
      // ignore in dev without preload
    }

    return () => {
      try {
        window.api.updates.removeAllListeners('update-available')
        window.api.updates.removeAllListeners('download-progress')
        window.api.updates.removeAllListeners('update-downloaded')
        window.api.updates.removeAllListeners('update-error')
      } catch (err) {
        // noop
      }
    }
  }, [])

  const startCheck = async (): Promise<void> => {
    try {
      setNotAvailableMessage(null)
      setChecking(true)
      await window.api.checkForUpdates()
    } catch (e) {
      console.error('Check failed', e)
      setChecking(false)
    }
  }

  const startDownload = async (): Promise<void> => {
    try {
      await window.api.downloadUpdate()
    } catch (e) {
      console.error('Download failed', e)
    }
  }

  const installAndRelaunch = async (): Promise<void> => {
    try {
      await window.api.installUpdate()
    } catch (e) {
      console.error('Install failed', e)
    }
  }

  return (
    <div>
      <ul className="versions">
        <li className="electron-version">Electron v{versions.electron}</li>
        <li className="chrome-version">Chromium v{versions.chrome}</li>
        <li className="node-version">Node v{versions.node}</li>
      </ul>

      <div className="app-versions">
        <div>Installed: {appVersion ?? '—'}</div>
        <div>Available: {availableVersion ?? '—'}</div>
      </div>

      <div className="update-check">
        <button onClick={startCheck} disabled={checking}>
          {checking ? 'Checking...' : 'Check for updates'}
        </button>
        <button
          className="show-app-version"
          onClick={() => {
            // debug helper: show app version by calling the same IPC
            try {
              if (window.api && typeof window.api.getAppVersion === 'function') {
                window.api.getAppVersion().then((v) => alert(`app version: ${v}`))
                return
              }
            } catch {}
            // fallback
            // @ts-ignore
            if ((window as any).electron?.ipcRenderer?.invoke) {
              // @ts-ignore
              ;(window as any).electron.ipcRenderer
                .invoke('get-app-version')
                .then((v: string) => alert(`app version: ${v}`))
            } else {
              alert('app version: not available')
            }
          }}
        >
          Show app version
        </button>
        {notAvailableMessage && <span className="update-msg">{notAvailableMessage}</span>}
      </div>

      {updateAvailable && !downloaded && (
        <div className="update-notification">
          <div>Update available{availableVersion ? `: v${availableVersion}` : ''}</div>
          <div className="update-actions">
            <button onClick={startDownload}>Download</button>
          </div>
          {downloadProgress !== null && <div>Downloading: {downloadProgress}%</div>}
        </div>
      )}

      {downloaded && (
        <div className="update-notification">
          <div>Update downloaded and ready to install.</div>
          <div className="update-actions">
            <button onClick={installAndRelaunch}>Install and Relaunch</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Versions
