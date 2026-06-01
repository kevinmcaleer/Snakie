import { useCallback, useEffect, useState } from 'react'
import type { FsEntry } from '../../../main/fs/types'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { ContextMenu, type ContextMenuItem, type ContextMenuPosition } from './ContextMenu'
import './LocalFileTree.css'

/**
 * Local (host) filesystem browser for issue #5.
 *
 * Offers an "Open Folder" action, an expandable tree of the chosen folder, and
 * opens files into the workspace store on click. Create/rename/delete actions
 * are available inline AND via a right-click context menu (issue #19), which
 * also exposes "Upload to board" — reading the local file via `fs.readFile`
 * and writing it to the connected device via `device.writeFile` (disabled when
 * no board is connected).
 *
 * Per the feedback UX cues a computer icon marks the local section and file
 * actions are revealed contextually (on row hover / selection / right-click).
 */

interface TreeNodeProps {
  entry: FsEntry
  depth: number
  selectedPath: string | null
  onSelect: (path: string, isDir: boolean) => void
  onOpenFile: (path: string) => void
  onChanged: () => void
  onContextMenu: (e: React.MouseEvent, entry: FsEntry) => void
}

/** Recursively renders a directory entry and (when expanded) its children. */
function TreeNode({
  entry,
  depth,
  selectedPath,
  onSelect,
  onOpenFile,
  onChanged,
  onContextMenu
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
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onOpenFile={onOpenFile}
            onChanged={onChanged}
            onContextMenu={onContextMenu}
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
  const { openFile } = useWorkspace()
  const deviceStatus = useDeviceStatus()
  const connected = deviceStatus.state === 'connected'
  const [root, setRoot] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedIsDir, setSelectedIsDir] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!root) return
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

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    try {
      const folder = await window.api.fs.openFolderDialog()
      if (folder) {
        setRoot(folder)
        setSelectedPath(folder)
        setSelectedIsDir(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

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
      const name = window.prompt('New file name', 'untitled.py')
      if (!name) return
      void run(() => window.api.fs.writeFile(join(dir, name), ''))
    },
    [dirFor, run]
  )

  const newFolderIn = useCallback(
    (target: FsEntry | null): void => {
      const dir = dirFor(target)
      if (!dir) return
      const name = window.prompt('New folder name', 'new-folder')
      if (!name) return
      void run(() => window.api.fs.mkdir(join(dir, name)))
    },
    [dirFor, run]
  )

  const renamePath = useCallback(
    (path: string): void => {
      if (!path || path === root) return
      const current = path.split(/[/\\]/).pop() ?? ''
      const name = window.prompt('Rename to', current)
      if (!name || name === current) return
      const parent = path.replace(/[/\\][^/\\]+$/, '')
      void run(() => window.api.fs.rename(path, join(parent || root!, name)))
    },
    [root, run]
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

  // Inline-button handlers delegate to the shared, target-aware helpers using
  // the current selection.
  const selectedEntry = useCallback(
    (): FsEntry | null =>
      selectedPath && selectedPath !== root
        ? { name: selectedPath.split(/[/\\]/).pop() ?? '', path: selectedPath, isDir: selectedIsDir }
        : null,
    [root, selectedIsDir, selectedPath]
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
    [connected, deletePath, handleOpenFile, newFileIn, newFolderIn, renamePath, uploadToBoard]
  )

  const hasSelection = !!selectedPath && selectedPath !== root
  const current = selectedEntry()

  return (
    <div className="localtree">
      <div className="localtree__header">
        <span className="localtree__title">
          <span aria-hidden>{'\u{1F4BB}'}</span> Local files
        </span>
      </div>

      {root ? (
        <>
          <div className="localtree__actions">
            <button className="btn btn--ghost" onClick={() => newFileIn(null)} title="New file">
              + File
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => newFolderIn(null)}
              title="New folder"
            >
              + Folder
            </button>
            {/* File-specific actions revealed only when an entry is selected. */}
            {hasSelection && (
              <>
                <button
                  className="btn btn--ghost"
                  onClick={() => current && renamePath(current.path)}
                  title="Rename"
                >
                  Rename
                </button>
                <button
                  className="btn btn--ghost btn--danger"
                  onClick={() => current && deletePath(current.path)}
                  title="Delete"
                >
                  Delete
                </button>
              </>
            )}
            <button
              className="btn btn--ghost"
              onClick={handleOpenFolder}
              title="Open a different folder"
            >
              Open Folder
            </button>
          </div>

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
              />
            ))}
          </div>
        </>
      ) : (
        <div className="localtree__empty">
          {error && <div className="localtree__error">{error}</div>}
          <button className="btn btn--primary" onClick={handleOpenFolder}>
            <span aria-hidden>{'\u{1F4C2}'}</span> Open Folder
          </button>
        </div>
      )}

      {menu && (
        <ContextMenu position={menu.position} items={menuItems(menu.entry)} onClose={closeMenu} />
      )}
    </div>
  )
}
