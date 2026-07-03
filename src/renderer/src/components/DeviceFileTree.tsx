import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DirEntry } from '../../../preload/index.d'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { useSync } from '../store/sync'
import { usageLabel, usedPct, type DiskUsage } from './disk-usage'
import { ContextMenu, type ContextMenuItem, type ContextMenuPosition } from './ContextMenu'
import { Placeholder } from './Placeholder'
import { usePrompt } from './PromptModal'
import {
  DEVICE_ROOT,
  flattenTree,
  joinDevicePath,
  nextSelection,
  parentDevicePath,
  planMove,
  pruneNested,
  type FlatRow
} from './device-tree-model'
import './DeviceFileTree.css'

/**
 * Device (MicroPython board) filesystem browser.
 *
 * Lists the connected board's filesystem via `window.api.device.listDir`,
 * starting at `/`, with directories expandable on demand (children are
 * lazy-loaded the first time a folder is opened). Clicking a file opens it in
 * the editor through the workspace store. The loaded listings live in one flat
 * `path → entries` map (#219) so a Refresh re-lists EVERY loaded folder (#220)
 * and range selection can see the whole visible tree.
 *
 * Gated on the live connection state from `useDeviceStatus()`: when no board is
 * connected it falls back to a friendly hint; when a board becomes connected the
 * tree (re)loads automatically.
 *
 * File MANAGEMENT (#219): Ctrl/Cmd-click toggles a multi-selection, Shift-click
 * selects a range, rows drag into folders (a device-side move/rename), a hover
 * ✕ deletes a row (or the whole selection it belongs to), and the context menu
 * offers "Delete N items" for a multi-selection. Plus the classic ops (new
 * file / new folder / rename / delete / open / download) inline and via the
 * right-click menu, mirroring the `LocalFileTree` UX.
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

/** The drag payload type for device-file moves (#219). */
const DEVICE_DRAG_MIME = 'application/x-snakie-device-paths'

/** One flattened, selectable, draggable tree row (#219). */
function DeviceRow({
  row,
  expanded,
  selected,
  dropTarget,
  onRowClick,
  onOpenFile,
  onContextMenu,
  onDeleteRow,
  onDragStartRow,
  onDropInto,
  onDragOverRow,
  onDragLeaveRow
}: {
  row: FlatRow
  expanded: boolean
  selected: boolean
  /** This folder row is the current drag-over target (highlight it). */
  dropTarget: boolean
  onRowClick: (e: React.MouseEvent, row: FlatRow) => void
  onOpenFile: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void
  onDeleteRow: (row: FlatRow) => void
  onDragStartRow: (e: React.DragEvent, row: FlatRow) => void
  onDropInto: (e: React.DragEvent, dir: string) => void
  onDragOverRow: (e: React.DragEvent, row: FlatRow) => void
  onDragLeaveRow: () => void
}): JSX.Element {
  const { path, entry, depth } = row
  return (
    <div
      className={`tree-row${selected ? ' is-selected' : ''}${dropTarget ? ' is-drop-target' : ''}`}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onClick={(e) => onRowClick(e, row)}
      onDoubleClick={() => {
        if (!entry.isDir) onOpenFile(path)
      }}
      onContextMenu={(e) => onContextMenu(e, path, entry.isDir)}
      role="treeitem"
      aria-expanded={entry.isDir ? expanded : undefined}
      aria-selected={selected}
      tabIndex={0}
      draggable
      onDragStart={(e) => onDragStartRow(e, row)}
      onDragOver={entry.isDir ? (e) => onDragOverRow(e, row) : undefined}
      onDragLeave={entry.isDir ? onDragLeaveRow : undefined}
      onDrop={entry.isDir ? (e) => onDropInto(e, path) : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onRowClick(e as unknown as React.MouseEvent, row)
        }
      }}
    >
      <span className="tree-row__glyph" aria-hidden>
        {entry.isDir ? (expanded ? '▼' : '▶') : '▤'}
      </span>
      <span className="tree-row__name">{entry.name}</span>
      {/* Hover delete (#219): removes this row — or the whole selection when the
          row is part of a multi-selection. */}
      <button
        type="button"
        className="tree-row__delete"
        title="Delete from the device"
        aria-label={`Delete ${entry.name}`}
        onClick={(e) => {
          e.stopPropagation()
          onDeleteRow(row)
        }}
      >
        ✕
      </button>
    </div>
  )
}

const ROOT = DEVICE_ROOT

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

  // The loaded listings, flat (#219): path → entries, always including ROOT.
  const [dirs, setDirs] = useState<Map<string, DirEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Multi-selection (#219): the selected paths + the shift-range anchor. The
  // PRIMARY (last-clicked) entry backs the single-target actions (rename, the
  // actions bar, new-file placement).
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [primary, setPrimary] = useState<{ path: string; isDir: boolean } | null>(null)
  // The folder row a drag is currently over (drop-target highlight).
  const [dropDir, setDropDir] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  // Flash usage for the bottom gauge (#211); null ⇒ unavailable, so it hides.
  const [disk, setDisk] = useState<DiskUsage | null>(null)

  const selectedPath = primary?.path ?? null
  const selectedIsDir = primary?.isDir ?? false
  const rows = useMemo(() => flattenTree(dirs, expanded), [dirs, expanded])

  /** Re-list one directory into the flat map (drop it if listing fails). */
  const listInto = useCallback(async (dir: string): Promise<void> => {
    try {
      const list = await window.api.device.listDir(dir)
      setDirs((m) => new Map(m).set(dir, list))
    } catch {
      setDirs((m) => {
        const next = new Map(m)
        next.delete(dir)
        return next
      })
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      // Read the root + the flash gauge together (the gauge is best-effort, so a
      // board that can't `statvfs` still shows its files).
      const [list, df] = await Promise.all([
        window.api.device.listDir(ROOT),
        window.api.device.df().catch(() => null)
      ])
      setDisk(df)
      setError(null)
      // Refresh updates the WHOLE loaded tree (#220): re-list every previously
      // loaded folder too, keeping the user's expansion state.
      const loaded = [...dirs.keys()].filter((d) => d !== ROOT)
      const results = await Promise.all(
        loaded.map(async (d) => {
          try {
            return [d, await window.api.device.listDir(d)] as const
          } catch {
            return null // the folder is gone — drop it
          }
        })
      )
      const next = new Map<string, DirEntry[]>()
      next.set(ROOT, list)
      for (const r of results) if (r) next.set(r[0], r[1])
      setDirs(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [dirs])

  // Load (or reset) the tree as the connection comes up / goes away. Loading
  // when `connected` flips true also covers reconnects to a different board.
  useEffect(() => {
    if (connected) {
      void refresh()
    } else {
      setDirs(new Map())
      setExpanded(new Set())
      setSelection(new Set())
      setAnchor(null)
      setPrimary(null)
      setError(null)
      setDisk(null)
    }
    // `refresh` depends on `dirs`; re-running on every dirs change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

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

  const handleOpenFile = useCallback(
    (path: string): void => {
      void openFile('device', path).catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
    },
    [openFile]
  )

  /** Toggle a folder open/closed, lazy-loading its listing on first open. */
  const toggleDir = useCallback(
    (path: string): void => {
      setExpanded((s) => {
        const next = new Set(s)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
      if (!dirs.has(path)) void listInto(path)
    },
    [dirs, listInto]
  )

  /**
   * Row click (#219): plain click keeps the classic behaviour (select; open a
   * file / toggle a folder) and resets the selection to that row; Ctrl/Cmd-click
   * toggles the row in the multi-selection; Shift-click selects the visible
   * range from the anchor.
   */
  const handleRowClick = useCallback(
    (e: React.MouseEvent, row: FlatRow): void => {
      const mode = e.metaKey || e.ctrlKey ? 'toggle' : e.shiftKey ? 'range' : 'single'
      const next = nextSelection(selection, anchor, rows, row.path, mode)
      setSelection(next.selection)
      setAnchor(next.anchor)
      setPrimary({ path: row.path, isDir: row.entry.isDir })
      if (mode === 'single') {
        if (row.entry.isDir) toggleDir(row.path)
        else handleOpenFile(row.path)
      }
    },
    [selection, anchor, rows, toggleDir, handleOpenFile]
  )

  /** Re-list a changed directory so the tree reflects an operation. */
  const refreshDir = useCallback(
    async (dir: string): Promise<void> => {
      await listInto(dir)
    },
    [listInto]
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
          setPrimary((p) => (p?.path === path ? { ...p, path: dest } : p))
          setSelection(new Set([dest]))
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

  /** Delete a set of paths (#219): confirm once, prune nested-redundant paths
   *  (removing a folder already removes its contents), remove each, re-list the
   *  affected parents, and clear the selection. */
  const deleteMany = useCallback(
    (paths: string[]): void => {
      const roots = pruneNested(paths)
      if (roots.length === 0) return
      const label =
        roots.length === 1
          ? `"${roots[0].split('/').pop()}"`
          : `${roots.length} items`
      if (!window.confirm(`Delete ${label} from the device? This cannot be undone.`)) return
      void (async (): Promise<void> => {
        setBusy(true)
        try {
          for (const p of roots) await window.api.device.remove(p)
          setError(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
          setSelection(new Set())
          setPrimary(null)
          setAnchor(null)
          const parents = [...new Set(roots.map(parentDevicePath))]
          await Promise.all(parents.map((d) => refreshDir(d)))
        }
      })()
    },
    [refreshDir]
  )

  const deletePath = useCallback((path: string): void => deleteMany([path]), [deleteMany])

  /** The hover ✕ (#219): a selected row deletes the whole selection. */
  const deleteRow = useCallback(
    (row: FlatRow): void => {
      deleteMany(selection.has(row.path) && selection.size > 1 ? [...selection] : [row.path])
    },
    [deleteMany, selection]
  )

  // --- drag a row (or the selection) into a folder (#219) -------------------
  const onDragStartRow = useCallback(
    (e: React.DragEvent, row: FlatRow): void => {
      const paths = selection.has(row.path) && selection.size > 1 ? [...selection] : [row.path]
      e.dataTransfer.setData(DEVICE_DRAG_MIME, JSON.stringify(paths))
      e.dataTransfer.effectAllowed = 'move'
    },
    [selection]
  )

  const onDragOverRow = useCallback((e: React.DragEvent, row: FlatRow): void => {
    if (!e.dataTransfer.types.includes(DEVICE_DRAG_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropDir(row.path)
  }, [])

  const onDropInto = useCallback(
    (e: React.DragEvent, destDir: string): void => {
      setDropDir(null)
      const raw = e.dataTransfer.getData(DEVICE_DRAG_MIME)
      if (!raw) return
      e.preventDefault()
      e.stopPropagation()
      let sources: string[] = []
      try {
        sources = JSON.parse(raw) as string[]
      } catch {
        return
      }
      const plan = planMove(sources, destDir)
      if (plan.length === 0) return
      void (async (): Promise<void> => {
        setBusy(true)
        try {
          for (const m of plan) await window.api.device.rename(m.from, m.to)
          setError(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
          setSelection(new Set())
          setPrimary(null)
          const affected = [...new Set([destDir, ...plan.map((m) => parentDevicePath(m.from))])]
          await Promise.all(affected.map((d) => refreshDir(d)))
        }
      })()
    },
    [refreshDir]
  )

  const closeMenu = useCallback((): void => setMenu(null), [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string | null, isDir: boolean): void => {
      e.preventDefault()
      e.stopPropagation()
      if (path) {
        setPrimary({ path, isDir })
        // Right-clicking OUTSIDE the multi-selection collapses it to that row;
        // inside it, the selection is kept so "Delete N items" can target it.
        setSelection((s) => (s.has(path) ? s : new Set([path])))
        setAnchor(path)
      }
      setMenu({ position: { x: e.clientX, y: e.clientY }, path, isDir })
    },
    []
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
        // Right-clicked inside a multi-selection (#219) → delete the whole set.
        if (selection.has(path) && selection.size > 1) {
          items.push({
            key: 'delete-many',
            label: `Delete ${selection.size} items`,
            danger: true,
            onSelect: () => deleteMany([...selection])
          })
        } else {
          items.push({
            key: 'delete',
            label: 'Delete',
            danger: true,
            onSelect: () => deletePath(path)
          })
        }
      }
      return items
    },
    [deleteMany, deletePath, downloadToComputer, handleOpenFile, newFileIn, newFolderIn, renamePath, selection]
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
        className={`devicetree__tree${dropDir === ROOT ? ' is-drop-target' : ''}`}
        role="tree"
        aria-label="Device file tree"
        aria-multiselectable="true"
        onContextMenu={(e) => handleContextMenu(e, null, true)}
        // Dropping on the background moves into the ROOT (#219).
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DEVICE_DRAG_MIME)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropDir(ROOT)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropDir(null)
        }}
        onDrop={(e) => onDropInto(e, ROOT)}
      >
        {rows.map((row) => (
          <DeviceRow
            key={row.path}
            row={row}
            expanded={expanded.has(row.path)}
            selected={selection.has(row.path) || selectedPath === row.path}
            dropTarget={dropDir === row.path}
            onRowClick={handleRowClick}
            onOpenFile={handleOpenFile}
            onContextMenu={handleContextMenu}
            onDeleteRow={deleteRow}
            onDragStartRow={onDragStartRow}
            onDropInto={onDropInto}
            onDragOverRow={onDragOverRow}
            onDragLeaveRow={() => setDropDir(null)}
          />
        ))}
        {!loading && !error && rows.length === 0 && (
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
