import { useCallback, useEffect, useState } from 'react'
import type { DirEntry } from '../../../preload/index.d'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { useSync } from '../store/sync'
import { usageLabel, usedPct, type DiskUsage } from './disk-usage'
import { ContextMenu, type ContextMenuItem, type ContextMenuPosition } from './ContextMenu'
import { Placeholder } from './Placeholder'
import { usePrompt } from './PromptModal'
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
 * File operations (new file / new folder / rename / delete / open) are exposed
 * inline AND via a right-click context menu (issue #19), mirroring the
 * `LocalFileTree` UX (window.prompt/confirm). The menu also offers "Download to
 * computer": read the device file via `device.readFile`, pick a destination
 * folder via `fs.openFolderDialog`, and write it with `fs.writeFile`. Device ops
 * run via `window.api.device.*`; after each op the affected directory is
 * re-listed so the tree reflects the change. Per the local-section UX, a
 * board/microcontroller icon marks the device section header.
 */

/**
 * Inline pixel icons matching the retro toolbar style (16×16, crispEdges),
 * mirroring the `LocalFileTree` header actions so the two file panes stay
 * visually consistent (issue #104).
 */
const iconProps = {
  viewBox: '0 0 16 16',
  width: 14,
  height: 14,
  shapeRendering: 'crispEdges' as const,
  'aria-hidden': true,
  focusable: false
}

// circular arrows (refresh) — re-read the device's root listing
const RefreshIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <path d="M3 8a5 5 0 0 1 8.5-3.5L13 3v4H9l1.6-1.6A3 3 0 0 0 5 8z" />
      <path d="M13 8a5 5 0 0 1-8.5 3.5L3 13V9h4l-1.6 1.6A3 3 0 0 0 11 8z" />
    </g>
  </svg>
)

// page with a `+` (new file)
const NewFileIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <path d="M3 1h6l4 4v10H3z M9 1v4h4" />
      <rect x="7" y="8" width="2" height="6" />
      <rect x="5" y="10" width="6" height="2" />
    </g>
  </svg>
)

// folder with a `+` (new folder)
const NewFolderIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <path d="M1 3h5l2 2h7v9H1z" />
      <rect x="7" y="8" width="2" height="5" fill="var(--bg-elevated)" />
      <rect x="5.5" y="9.5" width="5" height="2" fill="var(--bg-elevated)" />
    </g>
  </svg>
)

// two opposing arrows (sync) — push tagged local files to the device (#178)
const SyncIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <path d="M2 5h9V2l4 4-4 4V7H2z" />
      <path d="M14 11H5v3l-4-4 4-4v3h9z" />
    </g>
  </svg>
)

// checkmark — shown briefly when a sync completes (#178)
const CheckIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <path
      d="M2 8l4 4 8-9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

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
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void
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
  onContextMenu,
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
        onContextMenu={(e) => onContextMenu(e, path, entry.isDir)}
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
          {entry.isDir ? (expanded ? '▼' : '▶') : '▤'}
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
            onContextMenu={onContextMenu}
            reloadDir={reloadDir}
          />
        ))}
    </div>
  )
}

const ROOT = '/'

/** State backing an open context menu: where it is and what it targets. */
interface MenuState {
  position: ContextMenuPosition
  /** The right-clicked path, or null when the empty tree area was clicked. */
  path: string | null
  isDir: boolean
}

export function DeviceFileTree(): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  const { openFile } = useWorkspace()
  const prompt = usePrompt()
  // File sync (#178): tagged local files pushed to the device.
  const {
    syncedPaths,
    syncOnSave,
    status: syncStatus,
    error: syncError,
    setSyncOnSave,
    syncNow
  } = useSync()

  const [entries, setEntries] = useState<DirEntry[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedIsDir, setSelectedIsDir] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  // Signal used to tell already-expanded nodes to re-list a changed directory.
  const [reloadDir, setReloadDir] = useState<{ path: string; token: number } | null>(null)
  // Flash usage for the bottom gauge (#211); null ⇒ unavailable, so it hides.
  const [disk, setDisk] = useState<DiskUsage | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      // Read the listing + the flash gauge together (the gauge is best-effort, so
      // a board that can't `statvfs` still shows its files).
      const [list, df] = await Promise.all([
        window.api.device.listDir(ROOT),
        window.api.device.df().catch(() => null)
      ])
      setEntries(list)
      setDisk(df)
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
      setDisk(null)
    }
  }, [connected, refresh])

  // When a sync finishes, re-list the root so the just-pushed files appear.
  useEffect(() => {
    if (syncStatus === 'done' && connected) void refresh()
  }, [syncStatus, connected, refresh])

  // The single sync toggle: ON pushes the tagged files now AND auto-syncs on
  // every save; OFF stops auto-syncing.
  const toggleAutoSync = useCallback((): void => {
    if (syncOnSave) {
      setSyncOnSave(false)
    } else {
      setSyncOnSave(true)
      void syncNow()
    }
  }, [syncOnSave, setSyncOnSave, syncNow])

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
   * Resolve the directory a new file/folder should be created in for an
   * explicit target (right-clicked) or the current selection: a directory
   * itself, the parent of a file, or the root.
   */
  const dirFor = useCallback(
    (target: { path: string; isDir: boolean } | null): string => {
      const path = target ? target.path : selectedPath
      const isDir = target ? target.isDir : selectedIsDir
      if (!path) return ROOT
      return isDir ? path : parentDevicePath(path)
    },
    [selectedIsDir, selectedPath]
  )

  const newFileIn = useCallback(
    (target: { path: string; isDir: boolean } | null): void => {
      const dir = dirFor(target)
      void (async (): Promise<void> => {
        const name = await prompt('New file name (on device)', 'untitled.py')
        if (!name) return
        const dest = joinDevicePath(dir, name)
        await run(() => window.api.device.writeFile(dest, ''), dir)
      })()
    },
    [dirFor, prompt, run]
  )

  const newFolderIn = useCallback(
    (target: { path: string; isDir: boolean } | null): void => {
      const dir = dirFor(target)
      void (async (): Promise<void> => {
        const name = await prompt('New folder name (on device)', 'new-folder')
        if (!name) return
        const dest = joinDevicePath(dir, name)
        await run(() => window.api.device.mkdir(dest), dir)
      })()
    },
    [dirFor, prompt, run]
  )

  const renamePath = useCallback(
    (path: string): void => {
      const current = path.split('/').pop() ?? ''
      void (async (): Promise<void> => {
        const name = await prompt('Rename to', current)
        if (!name || name === current) return
        const parent = parentDevicePath(path)
        const dest = joinDevicePath(parent, name)
        await run(async () => {
          await window.api.device.rename(path, dest)
          setSelectedPath(dest)
        }, parent)
      })()
    },
    [prompt, run]
  )

  /**
   * Download a device file to the computer: read it via `device.readFile`, ask
   * for a destination folder via `fs.openFolderDialog`, then write it there
   * with `fs.writeFile`.
   */
  const downloadToComputer = useCallback((path: string): void => {
    const name = path.split('/').pop() ?? 'download'
    void (async (): Promise<void> => {
      try {
        const contents = await window.api.device.readFile(path)
        const folder = await window.api.fs.openFolderDialog()
        if (!folder) return
        const sep = folder.includes('\\') ? '\\' : '/'
        await window.api.fs.writeFile(`${folder}${sep}${name}`, contents)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [])

  const deletePath = useCallback(
    (path: string): void => {
      const name = path.split('/').pop()
      if (!window.confirm(`Delete "${name}" from the device? This cannot be undone.`)) return
      const parent = parentDevicePath(path)
      void run(async () => {
        await window.api.device.remove(path)
        setSelectedPath(null)
        setSelectedIsDir(false)
      }, parent)
    },
    [run]
  )

  const closeMenu = useCallback((): void => setMenu(null), [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string | null, isDir: boolean): void => {
      e.preventDefault()
      e.stopPropagation()
      if (path) handleSelect(path, isDir)
      setMenu({ position: { x: e.clientX, y: e.clientY }, path, isDir })
    },
    [handleSelect]
  )

  const menuItems = useCallback(
    (target: MenuState): ContextMenuItem[] => {
      const { path, isDir } = target
      const items: ContextMenuItem[] = [
        {
          key: 'new-file',
          label: 'New File',
          onSelect: () => newFileIn(path ? { path, isDir } : null)
        },
        {
          key: 'new-folder',
          label: 'New Folder',
          onSelect: () => newFolderIn(path ? { path, isDir } : null)
        }
      ]
      if (path) {
        if (!isDir) {
          items.push({ key: 'open', label: 'Open', onSelect: () => handleOpenFile(path) })
          items.push({
            key: 'download',
            label: 'Download to computer',
            onSelect: () => downloadToComputer(path)
          })
        }
        items.push({ key: 'rename', label: 'Rename', onSelect: () => renamePath(path) })
        items.push({
          key: 'delete',
          label: 'Delete',
          danger: true,
          onSelect: () => deletePath(path)
        })
      }
      return items
    },
    [deletePath, downloadToComputer, handleOpenFile, newFileIn, newFolderIn, renamePath]
  )

  if (!connected) {
    return (
      <div className="devicetree">
        <div className="devicetree__header">
          <span className="devicetree__title">
            <span aria-hidden>{'▦'}</span> Device files
          </span>
        </div>
        <Placeholder hint="Connect a board to browse its filesystem." />
      </div>
    )
  }

  const hasSelection = !!selectedPath
  const selectedTarget: { path: string; isDir: boolean } | null = selectedPath
    ? { path: selectedPath, isDir: selectedIsDir }
    : null

  return (
    <div className="devicetree">
      <div className="devicetree__header">
        <span className="devicetree__title">
          <span aria-hidden>{'▦'}</span> Device files
        </span>
        {/* Icon-only header actions mirroring the local section (issue #104):
            the file-sync toggle (#178), then Refresh, New file, New folder. */}
        <div className="devicetree__header-actions">
          {/* One sync toggle: turning it ON syncs the tagged files now AND keeps
              them auto-syncing on every save; turning it OFF stops auto-syncing.
              The icon turns into a green tick for a moment when a sync completes. */}
          <button
            className={`btn btn--ghost btn--icon devicetree__sync devicetree__sync--${syncStatus}${syncOnSave ? ' is-active' : ''}`}
            onClick={toggleAutoSync}
            disabled={syncStatus === 'syncing'}
            aria-pressed={syncOnSave}
            title={
              syncStatus === 'syncing'
                ? 'Syncing…'
                : syncStatus === 'error'
                  ? `Sync failed: ${syncError ?? 'unknown error'}`
                  : syncOnSave
                    ? `Auto-sync on (${syncedPaths.length} file${syncedPaths.length === 1 ? '' : 's'}) — click to stop`
                    : syncedPaths.length === 0
                      ? 'Turn on auto-sync (tick files in the Local tree to sync them)'
                      : `Sync ${syncedPaths.length} tagged file${syncedPaths.length === 1 ? '' : 's'} now and keep them in sync on save`
            }
            aria-label={syncOnSave ? 'Turn off automatic file sync' : 'Turn on automatic file sync'}
          >
            {syncStatus === 'done' ? <CheckIcon /> : <SyncIcon />}
          </button>
          <button
            className="btn btn--ghost btn--icon"
            onClick={() => void refresh()}
            disabled={loading || busy}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshIcon />
          </button>
          <button
            className="btn btn--ghost btn--icon"
            onClick={() => newFileIn(selectedTarget)}
            disabled={busy}
            title="New file"
            aria-label="New file"
          >
            <NewFileIcon />
          </button>
          <button
            className="btn btn--ghost btn--icon"
            onClick={() => newFolderIn(selectedTarget)}
            disabled={busy}
            title="New folder"
            aria-label="New folder"
          >
            <NewFolderIcon />
          </button>
        </div>
      </div>

      {/* Entry-specific actions revealed only when an entry is selected. */}
      {hasSelection && selectedPath && (
        <div className="devicetree__actions">
          <button
            className="btn btn--ghost"
            onClick={() => renamePath(selectedPath)}
            disabled={busy}
            title="Rename the selected item on the device"
          >
            Rename
          </button>
          <button
            className="btn btn--ghost btn--danger"
            onClick={() => deletePath(selectedPath)}
            disabled={busy}
            title="Delete the selected item from the device"
          >
            Delete
          </button>
        </div>
      )}

      {error && <div className="devicetree__error">{error}</div>}

      <div
        className="devicetree__tree"
        role="tree"
        aria-label="Device file tree"
        onContextMenu={(e) => handleContextMenu(e, null, true)}
      >
        {entries.map((entry) => (
          <DeviceTreeNode
            key={joinDevicePath(ROOT, entry.name)}
            entry={entry}
            path={joinDevicePath(ROOT, entry.name)}
            depth={0}
            selectedPath={selectedPath}
            onSelect={handleSelect}
            onOpenFile={handleOpenFile}
            onContextMenu={handleContextMenu}
            reloadDir={reloadDir}
          />
        ))}
        {!loading && !error && entries.length === 0 && (
          <div className="devicetree__empty-hint">Filesystem is empty.</div>
        )}
      </div>

      {menu && (
        <ContextMenu position={menu.position} items={menuItems(menu)} onClose={closeMenu} />
      )}

      {/* Flash-usage gauge (#211): a slim used/total bar pinned at the bottom.
          Only shown when the board reported `statvfs` (else `disk` is null). */}
      {disk && disk.total > 0 && (
        <div className="devicetree__disk" title={`${usageLabel(disk)} used of flash`}>
          <div className="devicetree__disk-bar" role="progressbar" aria-label="Device flash used" aria-valuenow={usedPct(disk)} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={`devicetree__disk-fill${usedPct(disk) >= 90 ? ' is-full' : usedPct(disk) >= 75 ? ' is-high' : ''}`}
              style={{ width: `${usedPct(disk)}%` }}
            />
          </div>
          <span className="devicetree__disk-label">
            {usedPct(disk)}% · {usageLabel(disk)}
          </span>
        </div>
      )}
    </div>
  )
}
