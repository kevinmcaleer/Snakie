import { useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { usePrompt } from './PromptModal'
import './UploadControls.css'

type Feedback = { kind: 'success' | 'error' | 'info'; message: string } | null

/** Join a folder and a file name with a single separator (host paths). */
function joinLocal(folder: string, name: string): string {
  const sep = folder.includes('\\') ? '\\' : '/'
  const trimmed = folder.replace(/[/\\]+$/, '')
  return `${trimmed}${sep}${name}`
}

/**
 * UploadControls — the transfer bridge that sits BETWEEN the two file panes.
 *
 * Layout maps to direction: the computer (local) pane is ABOVE and the board
 * (device) pane is BELOW, so:
 *   - Upload "to board" points DOWN (↓): write the active editor buffer to the
 *     connected device via `window.api.device.writeFile`.
 *   - Download "to computer" points UP (↑): take the active *device* file and
 *     save it to a host folder via `window.api.fs.writeFile`.
 *
 * This addresses the issue #9 feedback: the old "up" upload icon was
 * unintuitive, and the controls now live inline between the panes.
 */
export function UploadControls(): JSX.Element {
  const { openFiles, activeId } = useWorkspace()
  const status = useDeviceStatus()
  const prompt = usePrompt()
  const connected = status.state === 'connected'

  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const activeFile = openFiles.find((f) => f.id === activeId) ?? null

  const canUpload = connected && !!activeFile && !busy
  const canDownload = !!activeFile && activeFile.source === 'device' && !busy

  async function handleUpload(): Promise<void> {
    if (!activeFile || !connected) return
    const defaultPath = `/${activeFile.name}`
    const destPath = await prompt('Upload to device path:', defaultPath)
    if (destPath == null) return // cancelled
    const dest = destPath.trim()
    if (!dest) {
      setFeedback({ kind: 'error', message: 'A destination path is required.' })
      return
    }
    setBusy(true)
    setFeedback({ kind: 'info', message: `Uploading ${activeFile.name}…` })
    try {
      await window.api.device.writeFile(dest, activeFile.content)
      setFeedback({
        kind: 'success',
        message: `Uploaded to ${dest}. Refresh the board tree to see it.`
      })
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: `Upload failed: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDownload(): Promise<void> {
    if (!activeFile || activeFile.source !== 'device') return
    setBusy(true)
    setFeedback(null)
    try {
      const folder = await window.api.fs.openFolderDialog()
      if (!folder) {
        setBusy(false)
        return // cancelled
      }
      const dest = joinLocal(folder, activeFile.name)
      setFeedback({ kind: 'info', message: `Saving ${activeFile.name}…` })
      await window.api.fs.writeFile(dest, activeFile.content)
      setFeedback({ kind: 'success', message: `Saved to ${dest}.` })
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: `Download failed: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setBusy(false)
    }
  }

  const uploadTitle = !connected
    ? 'Connect a device to upload'
    : !activeFile
      ? 'Open a file to upload'
      : `Upload ${activeFile.name} to the board`

  const downloadTitle = !activeFile
    ? 'Open a file to download'
    : activeFile.source !== 'device'
      ? 'Select a device file to download to the computer'
      : `Save ${activeFile.name} to the computer`

  return (
    <div className="upload-controls" aria-label="Transfer files between computer and board">
      <div className="upload-controls__buttons">
        <button
          type="button"
          className="btn btn--ghost upload-controls__btn"
          onClick={() => void handleDownload()}
          disabled={!canDownload}
          title={downloadTitle}
        >
          <span className="upload-controls__glyph" aria-hidden="true">
            ↑
          </span>
          <span>Download to computer</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost upload-controls__btn"
          onClick={() => void handleUpload()}
          disabled={!canUpload}
          title={uploadTitle}
        >
          <span className="upload-controls__glyph" aria-hidden="true">
            ↓
          </span>
          <span>Upload to board</span>
        </button>
      </div>
      {feedback && (
        <p
          className={`upload-controls__feedback upload-controls__feedback--${feedback.kind}`}
          role="status"
          aria-live="polite"
        >
          {busy && <span className="upload-controls__spinner" aria-hidden="true" />}
          {feedback.message}
        </p>
      )}
    </div>
  )
}
