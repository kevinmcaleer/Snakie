import { useCallback, useEffect, useState } from 'react'
import type { DirEntry } from '../../../preload/index.d'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { Placeholder } from './Placeholder'
import './DeviceFileTree.css'

/**
 * Device (MicroPython board) filesystem browser.
 *
 * Lists the connected board's filesystem via `window.api.device.listDir`,
 * starting at `/`, with directories expandable on demand (children are
 * lazy-loaded the first time a folder is opened). Clicking a file opens it in
 * the editor through the workspace store.
 *
 * Gated on the live connection state from `useDeviceStatus()`: when no board is
 * connected it falls back to a friendly hint; when a board becomes connected the
 * tree (re)loads automatically. A Refresh action re-reads the root.
 *
 * File operations (create folder / rename / delete) are exposed inline, mirroring
 * the `LocalFileTree` UX (action buttons + window.prompt/confirm). They run via
 * `window.api.device.mkdir/rename/remove`; after each op the affected directory
 * is re-listed so the tree reflects the change. A full right-click context menu
 * is deferred to issue #19. Per the local-section UX, a board/microcontroller
 * icon marks the device section header.
 */

/** Join a device directory path and a child name into a POSIX device path. */
function joinDevicePath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

/** Return the parent directory of a POSIX device path (root maps to root). */
function parentDevicePath(path: string): string {
  const idx = path.lastIndexOf('/')
  if (idx <= 0) return '/'
  return path.slice(0, idx)
}

interface DeviceTreeNodeProps {
  entry: DirEntry
  /** Full device path of this entry. */
  path: string
  depth: number
  selectedPath: string | null
  onSelect: (path: string, isDir: boolean) => void
  onOpenFile: (path: string) => void
  /**
   * Path of a directory that has changed and whose listing should be
   * re-fetched, paired with a monotonically increasing token so repeated
   * changes to the same directory still trigger a reload.
   */
  reloadDir: { path: string; token: number } | null
}

/** Recursively renders a device entry and (when expanded) its children. */
function DeviceTreeNode({
  entry,
  path,
  depth,
  selectedPath,
  onSelect,
  onOpenFile,
  reloadDir
}: DeviceTreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadChildren = useCallback(async (): Promise<void> => {
    try {
      setChildren(await window.api.device.listDir(path))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [path])

  // When an operation reports that this directory changed, re-list it (only if
  // it has already been opened once — otherwise the children load lazily).
  useEffect(() => {
    if (reloadDir && reloadDir.path === path && children !== null) {
      void loadChildren()
    }
    // `reloadDir.token` changes on every signal, so identical-path reloads fire.
  }, [reloadDir, path, children, loadChildren])

  const toggle = useCallback(async (): Promise<void> => {
    if (!expanded && children === null) await loadChildren()
    setExpanded((v) => !v)
  }, [expanded, children, loadChildren])

  const handleClick = useCallback((): void => {
    onSelect(path, entry.isDir)
    if (entry.isDir) void toggle()
    else onOpenFile(path)
  }, [entry.isDir, path, onOpenFile, onSelect, toggle])

  const isSelected = selectedPath === path

  return (
    <div className="tree-node">
      <div
        className={`tree-row${isSelected ? ' is-selected' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={handleClick}
        role="treeitem"
        aria-expanded={entry.isDir ? expanded : undefined}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick()
          }
        }}
      >
        <span className="tree-row__glyph" aria-hidden>
          {entry.isDir ? (expanded ? '▼' : '▶') : '\u{1F4C4}'}
        </span>
        <span className="tree-row__name">{entry.name}</span>
      </div>
      {error && (
        <div className="tree-error" style={{ paddingLeft: `${depth * 14 + 22}px` }}>
          {error}
        </div>
      )}
      {entry.isDir &&
        expanded &&
        children?.map((child) => (
          <DeviceTreeNode
            key={joinDevicePath(path, child.name)}
            entry={child}
            path={joinDevicePath(path, child.name)}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onOpenFile={onOpenFile}
            reloadDir={reloadDir}
          />
        ))}
    </div>
  )
}

const ROOT = '/'

export function DeviceFileTree(): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  const { openFile } = useWorkspace()

  const [entries, setEntries] = useState<DirEntry[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedIsDir, setSelectedIsDir] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  // Signal used to tell already-expanded nodes to re-list a changed directory.
  const [reloadDir, setReloadDir] = useState<{ path: string; token: number } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setEntries(await window.api.device.listDir(ROOT))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Load (or reset) the tree as the connection comes up / goes away. Loading
  // when `connected` flips true also covers reconnects to a different board.
  useEffect(() => {
    if (connected) {
      void refresh()
    } else {
      setEntries([])
      setSelectedPath(null)
      setSelectedIsDir(false)
      setError(null)
    }
  }, [connected, refresh])

  const handleSelect = useCallback((path: string, isDir: boolean): void => {
    setSelectedPath(path)
    setSelectedIsDir(isDir)
  }, [])

  const handleOpenFile = useCallback(
    (path: string): void => {
      void openFile('device', path).catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
    },
    [openFile]
  )

  /**
   * Re-list a changed directory so the tree reflects an operation. The root is
   * re-fetched directly; deeper directories are signalled to any expanded node
   * via `reloadDir`.
   */
  const refreshDir = useCallback(
    async (dir: string): Promise<void> => {
      if (dir === ROOT) {
        await refresh()
      } else {
        setReloadDir({ path: dir, token: Date.now() })
      }
    },
    [refresh]
  )

  /** Run a device op, surface errors, and re-list the affected directory. */
  const run = useCallback(
    async (op: () => Promise<void>, affectedDir: string): Promise<void> => {
      setBusy(true)
      try {
        await op()
        setError(null)
        await refreshDir(affectedDir)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [refreshDir]
  )

  /**
   * Resolve the directory a new folder should be created in: the selected
   * directory, the parent of a selected file, or the root.
   */
  const targetDir = useCallback((): string => {
    if (!selectedPath) return ROOT
    if (selectedIsDir) return selectedPath
    return parentDevicePath(selectedPath)
  }, [selectedIsDir, selectedPath])

  const handleNewFolder = useCallback((): void => {
    const dir = targetDir()
    const name = window.prompt('New folder name (on device)', 'new-folder')
    if (!name) return
    const target = joinDevicePath(dir, name)
    void run(() => window.api.device.mkdir(target), dir)
  }, [run, targetDir])

  const handleRename = useCallback((): void => {
    if (!selectedPath) return
    const current = selectedPath.split('/').pop() ?? ''
    const name = window.prompt('Rename to', current)
    if (!name || name === current) return
    const parent = parentDevicePath(selectedPath)
    const dest = joinDevicePath(parent, name)
    void run(async () => {
      await window.api.device.rename(selectedPath, dest)
      setSelectedPath(dest)
    }, parent)
  }, [run, selectedPath])

  const handleDelete = useCallback((): void => {
    if (!selectedPath) return
    const name = selectedPath.split('/').pop()
    if (!window.confirm(`Delete "${name}" from the device? This cannot be undone.`)) return
    const parent = parentDevicePath(selectedPath)
    void run(async () => {
      await window.api.device.remove(selectedPath)
      setSelectedPath(null)
      setSelectedIsDir(false)
    }, parent)
  }, [run, selectedPath])

  if (!connected) {
    return (
      <div className="devicetree">
        <div className="devicetree__header">
          <span className="devicetree__title">
            <span aria-hidden>{'\u{1F50C}'}</span> Device files
          </span>
        </div>
        <Placeholder label="Device files" hint="Connect a board to browse its filesystem." />
      </div>
    )
  }

  const hasSelection = !!selectedPath

  return (
    <div className="devicetree">
      <div className="devicetree__header">
        <span className="devicetree__title">
          <span aria-hidden>{'\u{1F50C}'}</span> Device files
        </span>
        <button
          className="btn btn--ghost"
          onClick={() => void refresh()}
          disabled={loading || busy}
          title="Refresh device filesystem"
        >
          {loading ? '…' : '↻'} Refresh
        </button>
      </div>

      <div className="devicetree__actions">
        <button
          className="btn btn--ghost"
          onClick={handleNewFolder}
          disabled={busy}
          title="Create a folder on the device"
        >
          + Folder
        </button>
        {/* Entry-specific actions revealed only when an entry is selected. */}
        {hasSelection && (
          <>
            <button
              className="btn btn--ghost"
              onClick={handleRename}
              disabled={busy}
              title="Rename the selected item on the device"
            >
              Rename
            </button>
            <button
              className="btn btn--ghost btn--danger"
              onClick={handleDelete}
              disabled={busy}
              title="Delete the selected item from the device"
            >
              Delete
            </button>
          </>
        )}
      </div>

      {error && <div className="devicetree__error">{error}</div>}

      <div className="devicetree__tree" role="tree" aria-label="Device file tree">
        {entries.map((entry) => (
          <DeviceTreeNode
            key={joinDevicePath(ROOT, entry.name)}
            entry={entry}
            path={joinDevicePath(ROOT, entry.name)}
            depth={0}
            selectedPath={selectedPath}
            onSelect={handleSelect}
            onOpenFile={handleOpenFile}
            reloadDir={reloadDir}
          />
        ))}
        {!loading && !error && entries.length === 0 && (
          <div className="devicetree__empty-hint">Filesystem is empty.</div>
        )}
      </div>
    </div>
  )
}
