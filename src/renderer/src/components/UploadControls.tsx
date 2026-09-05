import { useCallback, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { IS_WEB } from '../lib/env'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { usePrompt } from './PromptModal'
import { useFileSelection } from '../store/file-selection'
import { planUploadOf, runFolderUpload } from '../lib/folder-transfer'
import { enqueueDeviceTask } from '../lib/device-queue'
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

  // Folder transfer (#848): the two panes' selections.
  const { local: localSel, deviceTargetDir } = useFileSelection()
  /**
   * Guards against a SECOND upload starting before the first has registered
   * (#850).
   *
   * `busy` disables the button, but React state lands asynchronously — two
   * quick clicks both read the old value, both pass, and two transfers write
   * the same paths at once. A ref updates synchronously, so the second click
   * sees the first immediately. (The device queue would serialise them anyway
   * since #837, but a click that quietly does nothing beats one that queues a
   * duplicate.)
   */
  const inFlight = useRef(false)

  const activeFile = openFiles.find((f) => f.id === activeId) ?? null

  // A highlighted FOLDER on the left turns the same button into "send that
  // folder". It takes precedence over the active buffer: the user pointed at
  // something specific, and quietly uploading a different file instead would be
  // the wrong kind of clever.
  const folderToUpload = localSel?.isDir ? localSel.path : null

  const canUpload = connected && (!!folderToUpload || !!activeFile) && !busy
  const canDownload = !!activeFile && activeFile.source === 'device' && !busy

  /**
   * Copy the highlighted local folder into the highlighted device folder.
   *
   * The copy is a QUEUED device task (#837), so it can neither start on top of a
   * running driver install nor have one start on top of it, and the shared
   * board-is-busy modal reports it — the per-file tick list of #848 is now this
   * task's steps.
   */
  const uploadFolder = useCallback(
    async (localRoot: string): Promise<void> => {
      setBusy(true)
      setFeedback(null)
      const name = hostBaseName(localRoot)
      try {
        const { root, copied } = await enqueueDeviceTask({
          key: `folder:${localRoot}->${deviceTargetDir}`,
          label: `Copying ${name} → ${deviceTargetDir}`,
          run: async (ctx) => {
            // Plan BEFORE claiming a file count, so the list the modal shows is
            // the real one rather than a guess that grows as the walk catches up.
            const plan = await planUploadOf(localRoot, deviceTargetDir)
            ctx.setSteps(plan.files.map((f) => f.label))
            const result = await runFolderUpload(
              plan,
              (event) =>
                ctx.step(
                  event.index,
                  event.state === 'copying' ? 'running' : event.state,
                  event.error
                ),
              () => ctx.cancelled
            )
            if (!result.ok) throw new Error(result.error ?? 'Copy stopped.')
            return { root: plan.root, copied: result.copied }
          }
        })
        setFeedback({
          kind: 'success',
          message: `Copied ${copied} file${copied === 1 ? '' : 's'} to ${root}.`
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setFeedback({ kind: 'error', message: `Copy stopped: ${message}` })
      } finally {
        setBusy(false)
      }
    },
    [deviceTargetDir]
  )

  async function handleUpload(): Promise<void> {
    if (!connected) return
    if (inFlight.current) return
    inFlight.current = true
    try {
      await runUpload()
    } finally {
      inFlight.current = false
    }
  }

  async function runUpload(): Promise<void> {
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
      await enqueueDeviceTask({
        key: `write:${dest}`,
        label: `Uploading ${activeFile.name} → ${dest}`,
        run: () => window.api.device.writeFile(dest, activeFile.content)
      })
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
