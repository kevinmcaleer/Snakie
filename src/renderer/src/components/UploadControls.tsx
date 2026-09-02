import { useCallback, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { IS_WEB } from '../lib/env'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { usePrompt } from './PromptModal'
import { useFileSelection } from '../store/file-selection'
import { planUploadOf, runFolderUpload } from '../lib/folder-transfer'
import { TransferProgressDialog, type TransferRow } from './TransferProgressDialog'
import { hostBaseName } from '../../../shared/transfer-plan'
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

  // Folder transfer (#848): the two panes' selections + the progress dialog.
  const { local: localSel, deviceTargetDir } = useFileSelection()
  const [transfer, setTransfer] = useState<{
    title: string
    rows: TransferRow[]
    running: boolean
    error: string | null
  } | null>(null)
  const cancelled = useRef(false)

  const activeFile = openFiles.find((f) => f.id === activeId) ?? null

  // A highlighted FOLDER on the left turns the same button into "send that
  // folder". It takes precedence over the active buffer: the user pointed at
  // something specific, and quietly uploading a different file instead would be
  // the wrong kind of clever.
  const folderToUpload = localSel?.isDir ? localSel.path : null

  const canUpload = connected && (!!folderToUpload || !!activeFile) && !busy
  const canDownload = !!activeFile && activeFile.source === 'device' && !busy

  /** Copy the highlighted local folder into the highlighted device folder. */
  const uploadFolder = useCallback(
    async (localRoot: string): Promise<void> => {
      cancelled.current = false
      setBusy(true)
      setFeedback(null)
      const name = hostBaseName(localRoot)
      const title = `Copying ${name} → ${deviceTargetDir}`
      // Plan BEFORE the dialog claims a file count, so the list it shows is the
      // real one rather than a guess that grows as the walk catches up.
      setTransfer({ title, rows: [], running: true, error: null })
      try {
        const plan = await planUploadOf(localRoot, deviceTargetDir)
        setTransfer({
          title: `Copying ${name} → ${plan.root}`,
          rows: plan.files.map((f) => ({ label: f.label, state: 'pending' as const })),
          running: true,
          error: null
        })

        const result = await runFolderUpload(
          plan,
          (event) => {
            setTransfer((prev) =>
              prev
                ? {
                    ...prev,
                    rows: prev.rows.map((row, i) =>
                      i === event.index
                        ? { ...row, state: event.state, error: event.error }
                        : row
                    )
                  }
                : prev
            )
          },
          () => cancelled.current
        )

        setTransfer((prev) =>
          prev ? { ...prev, running: false, error: result.ok ? null : (result.error ?? null) } : prev
        )
        setFeedback(
          result.ok
            ? {
                kind: 'success',
                message: `Copied ${result.copied} file${result.copied === 1 ? '' : 's'} to ${plan.root}.`
              }
            : { kind: 'error', message: `Copy stopped: ${result.error}` }
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setTransfer((prev) => (prev ? { ...prev, running: false, error: message } : prev))
        setFeedback({ kind: 'error', message: `Copy failed: ${message}` })
      } finally {
        setBusy(false)
      }
    },
    [deviceTargetDir]
  )

  async function handleUpload(): Promise<void> {
    if (!connected) return
    // A highlighted folder wins over the active buffer (#848).
    if (folderToUpload) return uploadFolder(folderToUpload)
    if (!activeFile) return
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
      if (IS_WEB) {
        // A per-file save picker — the folder dialog would ADOPT the picked
        // directory as the workspace root and silently re-point every open
        // tab's saves at it (#512).
        const dest = await window.api.fs.saveFileDialog(activeFile.name)
        if (!dest) {
          setBusy(false)
          return // cancelled
        }
        setFeedback({ kind: 'info', message: `Saving ${activeFile.name}…` })
        await window.api.fs.writeFile(dest, activeFile.content)
        setFeedback({ kind: 'success', message: `Saved ${activeFile.name}.` })
        setBusy(false)
        return
      }
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
    : folderToUpload
      ? `Copy the folder ${hostBaseName(folderToUpload)} into ${deviceTargetDir} on the device`
      : !activeFile
        ? 'Select a folder, or open a file, to upload'
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
      {transfer && (
        <TransferProgressDialog
          title={transfer.title}
          rows={transfer.rows}
          running={transfer.running}
          error={transfer.error}
          onCancel={() => {
            cancelled.current = true
          }}
          onClose={() => setTransfer(null)}
        />
      )}
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
