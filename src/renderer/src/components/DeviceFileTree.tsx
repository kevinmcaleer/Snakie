import { useCallback, useEffect, useState } from 'react'
import type { DirEntry } from '../../../preload/index.d'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { Placeholder } from './Placeholder'

/**
 * Device (MicroPython board) filesystem browser for issue #7.
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
 * File operations (create/rename/delete) are intentionally out of scope here —
 * they are tracked separately by issue #8. This component is browse + open +
 * refresh only. Per the local-section UX, a board/microcontroller icon marks
 * the device section header.
 */

/** Join a device directory path and a child name into a POSIX device path. */
function joinDevicePath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

interface DeviceTreeNodeProps {
  entry: DirEntry
  /** Full device path of this entry. */
  path: string
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  onOpenFile: (path: string) => void
}

/** Recursively renders a device entry and (when expanded) its children. */
function DeviceTreeNode({
  entry,
  path,
  depth,
  selectedPath,
  onSelect,
  onOpenFile
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

  const toggle = useCallback(async (): Promise<void> => {
    if (!expanded && children === null) await loadChildren()
    setExpanded((v) => !v)
  }, [expanded, children, loadChildren])

  const handleClick = useCallback((): void => {
    onSelect(path)
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
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
      setError(null)
    }
  }, [connected, refresh])

  const handleOpenFile = useCallback(
    (path: string): void => {
      void openFile('device', path).catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
    },
    [openFile]
  )

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

  return (
    <div className="devicetree">
      <div className="devicetree__header">
        <span className="devicetree__title">
          <span aria-hidden>{'\u{1F50C}'}</span> Device files
        </span>
        <button
          className="btn btn--ghost"
          onClick={() => void refresh()}
          disabled={loading}
          title="Refresh device filesystem"
        >
          {loading ? '…' : '↻'} Refresh
        </button>
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
            onSelect={setSelectedPath}
            onOpenFile={handleOpenFile}
          />
        ))}
        {!loading && !error && entries.length === 0 && (
          <div className="devicetree__empty-hint">Filesystem is empty.</div>
        )}
      </div>
    </div>
  )
}
