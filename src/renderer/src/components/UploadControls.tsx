import { useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { usePrompt } from './PromptModal'
import './UploadControls.css'

type Feedback = { kind: 'success' | 'error' | 'info'; message: string } | null

/** Inline pixel arrow icons matching the retro toolbar style (16×16). */
const iconProps = {
  viewBox: '0 0 16 16',
  width: 16,
  height: 16,
  shapeRendering: 'crispEdges' as const,
  'aria-hidden': true,
  focusable: false
}

// up arrow — Download to computer (the computer pane is above)
const ArrowUpIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <rect x="7" y="3" width="2" height="10" />
      <path d="M8 1l5 5H3z" />
    </g>
  </svg>
)

// down arrow — Upload to device (the board pane is below)
const ArrowDownIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <rect x="7" y="3" width="2" height="10" />
      <path d="M8 15l5-5H3z" />
    </g>
  </svg>
)

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
      : `Upload ${activeFile.name} to device`

  const downloadTitle = !activeFile
    ? 'Open a file to download'
    : activeFile.source !== 'device'
      ? 'Select a device file to download to the computer'
      : `Save ${activeFile.name} to the computer`

  return (
    <div className="upload-controls" aria-label="Transfer files between computer and board">
      <div className="upload-controls__buttons">
        {/* Icon-only buttons (issue #105): direction maps to layout — up arrow
            downloads to the computer (above), down arrow uploads to the device
            (below). Names live in the tooltip + aria-label only. */}
        <button
          type="button"
          className="btn btn--ghost btn--icon upload-controls__btn"
          onClick={() => void handleDownload()}
          disabled={!canDownload}
          title="Download to computer"
          aria-label={downloadTitle}
        >
          <ArrowUpIcon />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon upload-controls__btn"
          onClick={() => void handleUpload()}
          disabled={!canUpload}
          title="Upload to device"
          aria-label={uploadTitle}
        >
          <ArrowDownIcon />
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
