import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FsEntry } from '../../../main/fs/types'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { useSync } from '../store/sync'
import { ContextMenu, type ContextMenuItem, type ContextMenuPosition } from './ContextMenu'
import { usePrompt } from './PromptModal'
import './LocalFileTree.css'

/**
 * Local (host) filesystem browser for issue #5.
 *
 * Offers an expandable tree of the chosen folder and opens files into the
 * workspace store on click. The header keeps the actions compact (issue #87):
 * New File / New Folder are icon-only buttons, while Rename and Delete live
 * solely in the right-click context menu (issue #19) alongside "Upload to
 * board" — reading the local file via `fs.readFile` and writing it to the
 * connected device via `device.writeFile` (disabled when no board is
 * connected).
 *
 * The "Open Folder" button is replaced by a path breadcrumb of the current
 * working folder: each segment is a button that re-roots the tree to that
 * ancestor via `openFolderPath`. When no folder is open yet, a single small
 * "open folder" icon launches the native picker.
 */

/** Inline pixel icons matching the retro toolbar style (16×16, crispEdges). */
const iconProps = {
  viewBox: '0 0 16 16',
  width: 14,
  height: 14,
  shapeRendering: 'crispEdges' as const,
  'aria-hidden': true,
  focusable: false
}

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

// folder (open a different folder)
const OpenFolderIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <path d="M1 3h5l2 2h7v8H1z" fill="currentColor" />
  </svg>
)

// circular arrows (refresh) — re-read the current folder's listing
const RefreshIcon = (): JSX.Element => (
  <svg {...iconProps}>
    <g fill="currentColor">
      <path d="M3 8a5 5 0 0 1 8.5-3.5L13 3v4H9l1.6-1.6A3 3 0 0 0 5 8z" />
      <path d="M13 8a5 5 0 0 1-8.5 3.5L3 13V9h4l-1.6 1.6A3 3 0 0 0 11 8z" />
    </g>
  </svg>
)

interface TreeNodeProps {
  entry: FsEntry
  depth: number
  selectedPath: string | null
  onSelect: (path: string, isDir: boolean) => void
  onOpenFile: (path: string) => void
  onChanged: () => void
  onContextMenu: (e: React.MouseEvent, entry: FsEntry) => void
  /** Whether a (file) path is tagged to keep in sync with the device (#178). */
  isSynced: (path: string) => boolean
  /** Tag / untag a (file) path for device sync (#178). */
  toggleSync: (path: string) => void
  /** Bumped by the Refresh button — expanded folders re-read their children. */
  refreshNonce: number
}

/** Recursively renders a directory entry and (when expanded) its children. */
function TreeNode({
  entry,
  depth,
  selectedPath,
  onSelect,
  onOpenFile,
  onChanged,
  onContextMenu,
  isSynced,
  toggleSync,
  refreshNonce
}: TreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FsEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadChildren = useCallback(async (): Promise<void> => {
    try {
      setChildren(await window.api.fs.readDir(entry.path))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [entry.path])

  // Refresh signal from above: re-read an EXPANDED folder's children so newly
  // added/removed files show up (the root re-reads separately). Skip the first
  // render — only react to actual bumps.
  const firstNonce = useRef(refreshNonce)
  useEffect(() => {
    if (refreshNonce === firstNonce.current) return
    if (expanded) void loadChildren()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce])

  const toggle = useCallback(async (): Promise<void> => {
    if (!expanded && children === null) await loadChildren()
    setExpanded((v) => !v)
  }, [expanded, children, loadChildren])

  const handleClick = useCallback((): void => {
    onSelect(entry.path, entry.isDir)
    if (entry.isDir) void toggle()
    else onOpenFile(entry.path)
  }, [entry.isDir, entry.path, onOpenFile, onSelect, toggle])

  const isSelected = selectedPath === entry.path

  return (
    <div className="tree-node">
      <div
        className={`tree-row${isSelected ? ' is-selected' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry)}
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
        {!entry.isDir && (
          <span className="tree-row__sync">
            <input
              type="checkbox"
              className="tree-row__sync-check"
              checked={isSynced(entry.path)}
              onChange={() => toggleSync(entry.path)}
              // Don't let toggling the checkbox also open the file / fire the row.
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              title="Keep this file in sync with the device"
              aria-label={`Keep ${entry.name} in sync with the device`}
            />
            {/* At rest a tagged file shows this green sync glyph in place of the
                box; hovering/focusing the row swaps the real checkbox back in. */}
            <span className="tree-row__sync-icon" aria-hidden>
              ⇄
            </span>
          </span>
        )}
      </div>
      {error && (
        <div className="tree-error" style={{ paddingLeft: `${depth * 14 + 22}px` }}>
          {error}
        </div>
      )}
      {entry.isDir &&
        expanded &&
        children?.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onOpenFile={onOpenFile}
            onChanged={onChanged}
            onContextMenu={onContextMenu}
            isSynced={isSynced}
            toggleSync={toggleSync}
            refreshNonce={refreshNonce}
          />
        ))}
    </div>
  )
}

/** State backing an open context menu: where it is and what it targets. */
interface MenuState {
  position: ContextMenuPosition
  /** The right-clicked entry, or null when the empty tree area was clicked. */
  entry: FsEntry | null
}

export function LocalFileTree(): JSX.Element {
  const { openFile, currentFolder, openFolder, openFolderPath, newFile } = useWorkspace()
  const prompt = usePrompt()
  const deviceStatus = useDeviceStatus()
  const connected = deviceStatus.state === 'connected'
  const { isSynced, toggleSync } = useSync()
  // The working folder now lives in the workspace store so the toolbar and tree
  // share one entry point; `root` is just a local alias for readability.
  const root = currentFolder
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedIsDir, setSelectedIsDir] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  // Bumping this tells every EXPANDED subfolder to re-read its children too, so
  // Refresh reflects changes anywhere in the open tree (not just the root).
  const [refreshNonce, setRefreshNonce] = useState(0)
  const refresh = useCallback(async (): Promise<void> => {
    if (!root) return
    setRefreshNonce((n) => n + 1)
    try {
      setEntries(await window.api.fs.readDir(root))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [root])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // When the working folder changes (e.g. opened from the toolbar), reset the
  // selection to the new root so create actions target it.
  useEffect(() => {
    setSelectedPath(root)
    setSelectedIsDir(true)
  }, [root])

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    try {
      await openFolder()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [openFolder])

  const handleSelect = useCallback((path: string, isDir: boolean): void => {
    setSelectedPath(path)
    setSelectedIsDir(isDir)
  }, [])

  const handleOpenFile = useCallback(
    (path: string): void => {
      void openFile('local', path).catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
    },
    [openFile]
  )

  /**
   * Resolve the directory that a new file/folder should be created in: the
   * given (or selected) directory, the parent of a file, or the root.
   */
  const dirFor = useCallback(
    (target: FsEntry | null): string | null => {
      if (!root) return null
      const path = target ? target.path : selectedPath
      const isDir = target ? target.isDir : selectedIsDir
      if (!path || path === root) return root
      if (isDir) return path
      const parent = path.replace(/[/\\][^/\\]+$/, '')
      return parent || root
    },
    [root, selectedIsDir, selectedPath]
  )

  const join = (dir: string, name: string): string =>
    dir.includes('\\') ? `${dir}\\${name}` : `${dir}/${name}`

  const run = useCallback(
    async (op: () => Promise<void>): Promise<void> => {
      try {
        await op()
        setError(null)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [refresh]
  )

  const newFileIn = useCallback(
    (target: FsEntry | null): void => {
      const dir = dirFor(target)
      if (!dir) return
      void (async (): Promise<void> => {
        const name = await prompt('New file name', 'untitled.py')
        if (!name) return
        await run(() => window.api.fs.writeFile(join(dir, name), ''))
      })()
    },
    [dirFor, prompt, run]
  )

  const newFolderIn = useCallback(
    (target: FsEntry | null): void => {
      const dir = dirFor(target)
      if (!dir) return
      void (async (): Promise<void> => {
        const name = await prompt('New folder name', 'new-folder')
        if (!name) return
        await run(() => window.api.fs.mkdir(join(dir, name)))
      })()
    },
    [dirFor, prompt, run]
  )

  const renamePath = useCallback(
    (path: string): void => {
      if (!path || path === root) return
      const current = path.split(/[/\\]/).pop() ?? ''
      void (async (): Promise<void> => {
        const name = await prompt('Rename to', current)
        if (!name || name === current) return
        const parent = path.replace(/[/\\][^/\\]+$/, '')
        await run(() => window.api.fs.rename(path, join(parent || root!, name)))
      })()
    },
    [prompt, root, run]
  )

  const deletePath = useCallback(
    (path: string): void => {
      if (!path || path === root) return
      if (!window.confirm(`Delete "${path.split(/[/\\]/).pop()}"?`)) return
      void run(() => window.api.fs.remove(path))
    },
    [root, run]
  )

  /**
   * Upload a local file to the connected board: read it via `fs.readFile` and
   * write it to `/<name>` on the device via `device.writeFile`.
   */
  const uploadToBoard = useCallback(
    (entry: FsEntry): void => {
      if (!connected || entry.isDir) return
      const name = entry.path.split(/[/\\]/).pop() ?? entry.name
      void (async (): Promise<void> => {
        try {
          const contents = await window.api.fs.readFile(entry.path)
          await window.api.device.writeFile(`/${name}`, contents)
          setError(null)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })()
    },
    [connected]
  )

  const closeMenu = useCallback((): void => setMenu(null), [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FsEntry | null): void => {
      e.preventDefault()
      e.stopPropagation()
      if (entry) handleSelect(entry.path, entry.isDir)
      setMenu({ position: { x: e.clientX, y: e.clientY }, entry })
    },
    [handleSelect]
  )

  const menuItems = useCallback(
    (target: FsEntry | null): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [
        { key: 'new-file', label: 'New File', onSelect: () => newFileIn(target) },
        { key: 'new-folder', label: 'New Folder', onSelect: () => newFolderIn(target) }
      ]
      if (target) {
        if (!target.isDir) {
          items.push({ key: 'open', label: 'Open', onSelect: () => handleOpenFile(target.path) })
          items.push({
            key: 'upload',
            label: connected ? 'Upload to board' : 'Upload to board (not connected)',
            disabled: !connected,
            onSelect: () => uploadToBoard(target)
          })
          items.push({
            key: 'sync',
            label: isSynced(target.path) ? 'Stop syncing with device' : 'Keep in sync with device',
            onSelect: () => toggleSync(target.path)
          })
        }
        items.push({ key: 'rename', label: 'Rename', onSelect: () => renamePath(target.path) })
        items.push({
          key: 'delete',
          label: 'Delete',
          danger: true,
          onSelect: () => deletePath(target.path)
        })
      }
      return items
    },
    [
      connected,
      deletePath,
      handleOpenFile,
      isSynced,
      newFileIn,
      newFolderIn,
      renamePath,
      toggleSync,
      uploadToBoard
    ]
  )

  // Breadcrumb of the working folder: split on either separator and rebuild the
  // absolute path for each ancestor so a click can re-root the tree there.
  const crumbs = useMemo<{ label: string; path: string }[]>(() => {
    if (!root) return []
    const winDrive = /^[A-Za-z]:[/\\]/.test(root)
    const sep = root.includes('\\') ? '\\' : '/'
    const parts = root.split(/[/\\]/).filter((p) => p.length > 0)
    const result: { label: string; path: string }[] = []
    let acc = ''
    parts.forEach((part, i) => {
      if (i === 0) {
        // POSIX root keeps a leading slash; a Windows drive keeps its own form.
        acc = winDrive ? part : `${sep}${part}`
      } else {
        acc = `${acc}${sep}${part}`
      }
      result.push({ label: part, path: acc })
    })
    return result
  }, [root])

  return (
    <div className="localtree">
      <div className="localtree__header">
        <span className="localtree__title">
          <span aria-hidden>{'▣'}</span> Local files
        </span>
        <div className="localtree__header-actions">
          <button
            className="btn btn--ghost btn--icon"
            onClick={() => void refresh()}
            title="Refresh"
            aria-label="Refresh"
            disabled={!root}
          >
            <RefreshIcon />
          </button>
          <button
            className="btn btn--ghost btn--icon"
            // With no folder open this used to be a dead button; fall back to an
            // untitled buffer (same as the toolbar's New file) so "create a file
            // and run it" always works — on the web there may be no folder at all.
            onClick={() => (root ? newFileIn(null) : newFile())}
            title={root ? 'New file' : 'New untitled file'}
            aria-label="New file"
          >
            <NewFileIcon />
          </button>
          <button
            className="btn btn--ghost btn--icon"
            onClick={() => newFolderIn(null)}
            title="New folder"
            aria-label="New folder"
            disabled={!root}
          >
            <NewFolderIcon />
          </button>
          <button
            className="btn btn--ghost btn--icon"
            onClick={handleOpenFolder}
            title="Open folder"
            aria-label="Open folder"
          >
            <OpenFolderIcon />
          </button>
        </div>
      </div>

      {root ? (
        <>
          {/* Breadcrumb of the working folder: each ancestor re-roots the tree. */}
          <nav className="localtree__breadcrumb" aria-label="Working folder path">
            {crumbs.map((crumb, i) => (
              <span className="localtree__crumb-wrap" key={crumb.path}>
                {i > 0 && (
                  <span className="localtree__crumb-sep" aria-hidden>
                    /
                  </span>
                )}
                <button
                  className="localtree__crumb"
                  onClick={() => openFolderPath(crumb.path)}
                  title={crumb.path}
                  aria-current={i === crumbs.length - 1 ? 'true' : undefined}
                  disabled={i === crumbs.length - 1}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </nav>

          {error && <div className="localtree__error">{error}</div>}

          <div
            className="localtree__tree"
            role="tree"
            aria-label="Local file tree"
            onContextMenu={(e) => handleContextMenu(e, null)}
          >
            {entries.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                selectedPath={selectedPath}
                onSelect={handleSelect}
                onOpenFile={handleOpenFile}
                onChanged={refresh}
                onContextMenu={handleContextMenu}
                isSynced={isSynced}
                toggleSync={toggleSync}
                refreshNonce={refreshNonce}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="localtree__empty">
          {error && <div className="localtree__error">{error}</div>}
          <button className="btn btn--primary" onClick={handleOpenFolder}>
            <span aria-hidden>{'▸'}</span> Open Folder
          </button>
        </div>
      )}

      {menu && (
        <ContextMenu position={menu.position} items={menuItems(menu.entry)} onClose={closeMenu} />
      )}
    </div>
  )
}
