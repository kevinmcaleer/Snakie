import { useCallback, useEffect, useState } from 'react'
import type { FsEntry } from '../../../main/fs/types'
import { useWorkspace } from '../store/workspace'

/**
 * Local (host) filesystem browser for issue #5.
 *
 * Offers an "Open Folder" action, an expandable tree of the chosen folder, and
 * opens files into the workspace store on click. Basic create/rename/delete
 * actions are exposed inline; a full right-click context menu is deferred to
 * issue #19.
 *
 * Per the feedback UX cues a computer icon marks the local section and file
 * actions are revealed contextually (on row hover / selection).
 */

interface TreeNodeProps {
  entry: FsEntry
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  onOpenFile: (path: string) => void
  onChanged: () => void
}

/** Recursively renders a directory entry and (when expanded) its children. */
function TreeNode({
  entry,
  depth,
  selectedPath,
  onSelect,
  onOpenFile,
  onChanged
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
    onSelect(entry.path)
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
          />
        ))}
    </div>
  )
}

export function LocalFileTree(): JSX.Element {
  const { openFile } = useWorkspace()
  const [root, setRoot] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
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
   * selected directory, the parent of the selected file, or the root.
   */
  const targetDir = useCallback((): string | null => {
    if (!root) return null
    if (!selectedPath || selectedPath === root) return root
    // If a file is selected, create alongside it (use its parent dir).
    const parent = selectedPath.replace(/[/\\][^/\\]+$/, '')
    return parent || root
  }, [root, selectedPath])

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

  const handleNewFile = useCallback((): void => {
    const dir = targetDir()
    if (!dir) return
    const name = window.prompt('New file name', 'untitled.py')
    if (!name) return
    void run(() => window.api.fs.writeFile(join(dir, name), ''))
  }, [run, targetDir])

  const handleNewFolder = useCallback((): void => {
    const dir = targetDir()
    if (!dir) return
    const name = window.prompt('New folder name', 'new-folder')
    if (!name) return
    void run(() => window.api.fs.mkdir(join(dir, name)))
  }, [run, targetDir])

  const handleRename = useCallback((): void => {
    if (!selectedPath || selectedPath === root) return
    const current = selectedPath.split(/[/\\]/).pop() ?? ''
    const name = window.prompt('Rename to', current)
    if (!name || name === current) return
    const parent = selectedPath.replace(/[/\\][^/\\]+$/, '')
    void run(() => window.api.fs.rename(selectedPath, join(parent || root!, name)))
  }, [root, run, selectedPath])

  const handleDelete = useCallback((): void => {
    if (!selectedPath || selectedPath === root) return
    if (!window.confirm(`Delete "${selectedPath.split(/[/\\]/).pop()}"?`)) return
    void run(() => window.api.fs.remove(selectedPath))
  }, [root, run, selectedPath])

  const hasSelection = !!selectedPath && selectedPath !== root

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
            <button className="btn btn--ghost" onClick={handleNewFile} title="New file">
              + File
            </button>
            <button className="btn btn--ghost" onClick={handleNewFolder} title="New folder">
              + Folder
            </button>
            {/* File-specific actions revealed only when an entry is selected. */}
            {hasSelection && (
              <>
                <button className="btn btn--ghost" onClick={handleRename} title="Rename">
                  Rename
                </button>
                <button
                  className="btn btn--ghost btn--danger"
                  onClick={handleDelete}
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

          <div className="localtree__tree" role="tree" aria-label="Local file tree">
            {entries.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                onOpenFile={handleOpenFile}
                onChanged={refresh}
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
    </div>
  )
}
