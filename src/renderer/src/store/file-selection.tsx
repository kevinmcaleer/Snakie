/**
 * What is highlighted in each half of the Files panel (#848).
 *
 * Both trees already track their own selection, and that was fine while nothing
 * else needed to know. "Copy the selected folder into the selected folder" needs
 * BOTH at once, from a third component that sits between them and owns neither —
 * so the selections are published here rather than lifted into either tree.
 *
 * Deliberately a plain context holding two small values. It is not a mirror of
 * the trees' internal state: the trees stay in charge of what selection MEANS
 * (multi-select, shift ranges, drop targets), and simply announce the one thing
 * the transfer bridge has to know.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** A highlighted row, on either side. */
export interface FileSelection {
  /** Absolute path — a host path on the local side, a device path on the board side. */
  path: string
  /** True when the row is a directory. */
  isDir: boolean
}

export interface FileSelectionStore {
  /** The highlighted row in the local (computer) tree. */
  local: FileSelection | null
  /** The highlighted row in the device (board) tree. */
  device: FileSelection | null
  setLocal: (selection: FileSelection | null) => void
  setDevice: (selection: FileSelection | null) => void
  /**
   * The device DIRECTORY a transfer should land in.
   *
   * A file is a perfectly reasonable thing to have highlighted, and it names a
   * folder just as well — its parent. Returning `/` when nothing is selected
   * means the button is never dead for want of a click in the other pane.
   */
  deviceTargetDir: string
}

const FileSelectionContext = createContext<FileSelectionStore | null>(null)

/** The parent directory of a device path: `/lib/x.py` → `/lib`, `/x.py` → `/`. */
export function parentOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length === 0 ? '/' : `/${parts.join('/')}`
}

/** Resolve a selection to the device folder a transfer targets. */
export function targetDirFor(selection: FileSelection | null): string {
  if (!selection) return '/'
  return selection.isDir ? selection.path : parentOf(selection.path)
}

export function FileSelectionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [local, setLocalState] = useState<FileSelection | null>(null)
  const [device, setDeviceState] = useState<FileSelection | null>(null)

  const setLocal = useCallback((s: FileSelection | null) => setLocalState(s), [])
  const setDevice = useCallback((s: FileSelection | null) => setDeviceState(s), [])

  const value = useMemo<FileSelectionStore>(
    () => ({ local, device, setLocal, setDevice, deviceTargetDir: targetDirFor(device) }),
    [local, device, setLocal, setDevice]
  )

  return (
    <FileSelectionContext.Provider value={value}>{children}</FileSelectionContext.Provider>
  )
}

/**
 * Read the current selections.
 *
 * Returns an inert store when no provider is above it, so a tree rendered on its
 * own (a test, a pop-out window) still works — publishing a selection nothing
 * listens to is harmless, and the alternative is a crash in a file panel.
 */
export function useFileSelection(): FileSelectionStore {
  const ctx = useContext(FileSelectionContext)
  return (
    ctx ?? {
      local: null,
      device: null,
      setLocal: () => undefined,
      setDevice: () => undefined,
      deviceTargetDir: '/'
    }
  )
}
