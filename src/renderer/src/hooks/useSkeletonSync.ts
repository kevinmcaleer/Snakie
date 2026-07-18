/**
 * useSkeletonSync (#537, epic #533 §2) — keeps `skeleton.json` in step with the
 * project URDF, and the board's copy in step with the project.
 *
 * The URDF is the single source of truth; skeleton.json is DERIVED, never
 * hand-edited (see `src/shared/skeleton.ts` for the schema). This hook wires the
 * pure generator into the app's decoupled save seam:
 *
 *   - Saving a `.urdf` file (editor Ctrl+S or a Robot View edit — both land in
 *     `saveFile`) regenerates `<project>/skeleton.json` next to robot.yml, with
 *     servo bindings pulled from the project's `servoJointMap`.
 *   - Saving `robot.yml` BY HAND in the editor regenerates too (bindings may
 *     have changed). In-app binding edits are covered by the robot:save layers
 *     (main process + web backend), which regenerate on every robot.yml save.
 *   - The regenerated file is announced via {@link announceSaved}, so the file
 *     tree refreshes and — when tagged for file sync (#178) with sync-on-save —
 *     it's pushed to the board as part of normal project sync.
 *   - On device CONNECT, the board's `/skeleton.json` is compared (by embedded
 *     `urdf_hash`) against the project's; a stale copy prompts
 *     "skeleton out of date — sync?" and re-pushes on confirm.
 *
 * Mounted once by AppShell (main window). All work is best-effort and silent on
 * failure — a missing robot.yml or an unwritable folder never breaks saving.
 */
import { useEffect, useRef } from 'react'
import {
  generateSkeleton,
  readSkeletonHash,
  SKELETON_DEVICE_PATH,
  skeletonJson,
  skeletonPathFor
} from '../../../shared/skeleton'
import { readRobotModel } from '../../../shared/krf'
import { robotFromYaml } from '../../../shared/robot-yaml'
import {
  announceSaved,
  FILE_SAVED_EVENT,
  type FileSavedDetail
} from '../store/workspace'

/** `parent/of/file.ext` → `parent/of` (empty for a bare name); keeps `\` paths. */
function dirOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at > 0 ? path.slice(0, at) : ''
}

/** Join a host folder + name with the folder's own separator style. */
function joinPath(folder: string, name: string): string {
  const sep = folder.includes('\\') ? '\\' : '/'
  return `${folder.replace(/[/\\]+$/, '')}${sep}${name}`
}

/** Surface a transient status-bar message (the shared `snakie:status` slot). */
function emitStatus(text: string): void {
  try {
    window.dispatchEvent(new CustomEvent('snakie:status', { detail: { text, priority: 2 } }))
    if (text) {
      setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent('snakie:status', { detail: { text: '' } }))
        } catch {
          /* the next message overwrites the slot anyway */
        }
      }, 4000)
    }
  } catch {
    /* status is cosmetic */
  }
}

/** Regenerate `<project>/skeleton.json` from a URDF's content + the project's
 *  servo map, and announce the write. Best-effort. */
async function regenerateFromUrdf(urdfPath: string, urdf: string): Promise<void> {
  const skelPath = skeletonPathFor(urdfPath)
  const folder = dirOf(skelPath)
  let map
  try {
    const def = await window.api.robot.load(folder || undefined)
    map = readRobotModel(def)?.servoJointMap
  } catch {
    map = undefined // no robot.yml — the skeleton still carries the kinematics
  }
  const json = skeletonJson(generateSkeleton(urdf, map))
  await window.api.fs.writeFile(skelPath, json)
  announceSaved('local', skelPath, json)
}

/** Regenerate from a hand-saved robot.yml: follow its `robot.urdf` link. */
async function regenerateFromRobotYml(ymlPath: string, yml: string): Promise<void> {
  let urdfRel: string | undefined
  try {
    urdfRel = readRobotModel(robotFromYaml(yml))?.urdf
  } catch {
    return // malformed YAML — the robot layer handles backup/recovery
  }
  if (!urdfRel) return
  const folder = dirOf(ymlPath)
  const urdfPath = folder ? joinPath(folder, urdfRel) : urdfRel
  const urdf = await window.api.fs.readFile(urdfPath)
  await regenerateFromUrdf(urdfPath, urdf)
}

/**
 * Keep skeleton.json current (regenerate on save) and the connected board's
 * copy fresh (staleness check + optional re-push on connect).
 */
export function useSkeletonSync(currentFolder: string | null): void {
  const folderRef = useRef(currentFolder)
  folderRef.current = currentFolder

  // Regenerate on save of a .urdf (or a hand-edited robot.yml).
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<FileSavedDetail>).detail
      if (!detail || detail.source !== 'local' || !detail.path) return
      const lower = detail.path.toLowerCase()
      const run = lower.endsWith('.urdf')
        ? regenerateFromUrdf(detail.path, detail.content)
        : /(^|[/\\])robot\.yml$/.test(lower)
          ? regenerateFromRobotYml(detail.path, detail.content)
          : null
      run?.catch(() => undefined) // best-effort: never let regen break a save
    }
    window.addEventListener(FILE_SAVED_EVENT, handler)
    return () => window.removeEventListener(FILE_SAVED_EVENT, handler)
  }, [])

  // Connect-time staleness check: the board's copy vs the project's.
  useEffect(() => {
    let wasConnected = false
    const check = async (): Promise<void> => {
      const folder = folderRef.current
      if (!folder) return
      let local: string
      try {
        local = await window.api.fs.readFile(joinPath(folder, 'skeleton.json'))
      } catch {
        return // no project skeleton — nothing to compare
      }
      const localHash = readSkeletonHash(local)
      if (!localHash) return
      let onBoard: string | null
      try {
        onBoard = await window.api.device.readFile(SKELETON_DEVICE_PATH)
      } catch {
        onBoard = null // board has no skeleton yet — sync (#178) installs it
      }
      if (onBoard === null || readSkeletonHash(onBoard) === localHash) return
      // `window.confirm` is fine in the Electron renderer (unlike prompt()).
      if (window.confirm('The skeleton on the board is out of date — sync skeleton.json now?')) {
        try {
          await window.api.device.writeFile(SKELETON_DEVICE_PATH, local)
          emitStatus('skeleton.json synced to the board')
        } catch (err) {
          emitStatus(`Couldn't sync skeleton.json: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
    const onStatus = (s: { state: string }): void => {
      const connected = s.state === 'connected'
      if (connected && !wasConnected) void check().catch(() => undefined)
      wasConnected = connected
    }
    window.api.device
      .getStatus()
      .then((s) => {
        wasConnected = s.state === 'connected'
      })
      .catch(() => undefined)
    return window.api.device.onStatus(onStatus)
  }, [])
}
