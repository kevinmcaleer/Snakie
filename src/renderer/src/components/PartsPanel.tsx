import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { PartCanvas } from './PartCanvas'
import { PartSchematicView } from './PartSchematicView'
import { availableToInstall } from '../../../shared/part-registry'
import type {
  LibraryUpdate,
  PartDefinition,
  PartLibrary,
  PartLibraryWithParts,
  RegistryEntry
} from '../../../preload/index.d'
import './PartsPanel.css'

/**
 * PARTS LIBRARY PANEL (#129)
 * ==========================
 *
 * Browses the user's installed parts libraries (read off disk by the main
 * process, image assets inlined), lets them search across every part, drill into
 * a part's detail (pinout table + footprint + metadata), author new parts (opens
 * the Part Editor), and manage community libraries from the master registry
 * (browse + install + update). It is the home of the activity-bar "Parts" view.
 *
 * Opening the Part Editor is decoupled via a window CustomEvent (mirrors the
 * settings deep-link + "send to chat" patterns) so AppShell can mount the editor
 * overlay without this panel threading a callback up the tree.
 */

/** The id of the auto-created library that holds the user's own authored parts
 *  (mirrors LOCAL_LIBRARY_ID in src/main/parts/library.ts). */
export const LOCAL_LIBRARY_ID = 'my-parts'

/** Window CustomEvent that asks the host to open the Part Editor overlay. */
export const OPEN_PART_EDITOR_EVENT = 'snakie:open-part-editor'
/** Window CustomEvent AppShell fires after the editor saves/closes → refresh. */
export const PARTS_CHANGED_EVENT = 'snakie:parts-changed'

/** The bundled "Standard Boards" library id (promote target). */
const STANDARD_LIBRARY_ID = 'snakie-standard'

/** Detail payload for {@link OPEN_PART_EDITOR_EVENT}. */
export interface OpenPartEditorDetail {
  libraryId: string
  part: PartDefinition | null
}

/** Dispatch the "open the Part Editor" event. */
function openEditor(libraryId: string, part: PartDefinition | null): void {
  window.dispatchEvent(
    new CustomEvent<OpenPartEditorDetail>(OPEN_PART_EDITOR_EVENT, { detail: { libraryId, part } })
  )
}

type IconName = 'edit' | 'duplicate' | 'promote' | 'delete' | 'refresh' | 'folder'

/** Line-icon glyphs (16×16, currentColor) — hoisted so the record isn't rebuilt
 *  on every render. */
const ICON_PATHS: Record<IconName, JSX.Element> = {
  // Pencil.
  edit: (
    <>
      <path d="M11.1 2.6a1.4 1.4 0 0 1 2 2L5.6 12 3 13l1-2.6 7.1-7.8Z" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
      <path d="M9.6 4.1l2.3 2.3" stroke="currentColor" strokeWidth={1.3} />
    </>
  ),
  // Two overlapping sheets.
  duplicate: (
    <>
      <rect x={5.5} y={5.5} width={7.5} height={8} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.3} />
      <path d="M3 10.5V3.2A1.2 1.2 0 0 1 4.2 2H10" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </>
  ),
  // Up-arrow rising to a shelf (promote/upgrade to Standard).
  promote: (
    <>
      <path d="M8 11V4M8 4 5 7M8 4l3 3" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 13h9" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </>
  ),
  // Trash can.
  delete: (
    <>
      <path d="M3.5 4.5h9M6.5 4.5V3.2A1 1 0 0 1 7.5 2.2h1a1 1 0 0 1 1 1V4.5" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M4.5 4.5 5 13a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.5-8.5" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 6.8v4.4M9 6.8v4.4" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
    </>
  ),
  // Circular arrow.
  refresh: (
    <>
      <path d="M12.5 8a4.5 4.5 0 1 1-1.3-3.2" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M12.6 2.5v2.6h-2.6" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Folder (reveal the parts folder).
  folder: (
    <path
      d="M2.4 5.2V4a1 1 0 0 1 1-1h2.4l1.3 1.5h5.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V5.2Z"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinejoin="round"
    />
  )
}

/** A small line-icon (16×16, currentColor) for the toolbar + part action buttons —
 *  so the actions read as icons, not text/emoji. */
function actionIcon(name: IconName): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {ICON_PATHS[name]}
    </svg>
  )
}

export interface PartsPanelProps {
  /** When provided, the part detail shows an "Add to project" button that adds
   *  the part to robot.yml (wired by the board window). */
  onAddToProject?: (libraryId: string, part: PartDefinition) => void
}

export function PartsPanel({ onAddToProject }: PartsPanelProps = {}): JSX.Element {
  const [libraries, setLibraries] = useState<PartLibraryWithParts[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{ libraryId: string; partId: string } | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Registry browser state.
  const [showRegistry, setShowRegistry] = useState(false)
  const [registry, setRegistry] = useState<RegistryEntry[] | null>(null)
  const [registryLoading, setRegistryLoading] = useState(false)
  const [updates, setUpdates] = useState<LibraryUpdate[]>([])
  const [busyLib, setBusyLib] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const libs = await window.api.parts.listLibraries()
      setLibraries(libs)
    } catch {
      setLibraries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Re-read after the editor saves/closes (fired by AppShell).
  useEffect(() => {
    const handler = (): void => void refresh()
    window.addEventListener(PARTS_CHANGED_EVENT, handler)
    return () => window.removeEventListener(PARTS_CHANGED_EVENT, handler)
  }, [refresh])

  // DEV: promote a microcontroller board part into the Standard Boards library.
  const promote = useCallback(
    async (libraryId: string, part: PartDefinition): Promise<void> => {
      const res = await window.api.parts.promoteToStandard(libraryId, part.id)
      if (res.ok) {
        setNote(`Promoted "${part.name}" to Standard Boards${res.shipped ? ' + bundled repo copy' : ''}.`)
        await refresh()
      } else {
        setNote(res.error ?? 'Promote failed.')
      }
    },
    [refresh]
  )

  // Quietly check for updates once libraries are known.
  useEffect(() => {
    if (libraries.length === 0) return
    let cancelled = false
    window.api.parts
      .checkUpdates()
      .then((u) => {
        if (!cancelled) setUpdates(u.filter((x) => x.updateAvailable))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [libraries])

  const allParts = useMemo(
    () =>
      libraries.flatMap((lib) =>
        lib.parts.map((part) => ({ libraryId: lib.id, libraryName: lib.name, part }))
      ),
    [libraries]
  )

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!q) return allParts
    return allParts.filter(({ part }) => {
      const hay = [
        part.name,
        part.description,
        part.manufacturer,
        part.family,
        ...(part.tags ?? [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [allParts, q])

  const selectedPart: { libraryId: string; part: PartDefinition } | null = useMemo(() => {
    if (!selected) return null
    const lib = libraries.find((l) => l.id === selected.libraryId)
    const part = lib?.parts.find((p) => p.id === selected.partId)
    return part ? { libraryId: selected.libraryId, part } : null
  }, [selected, libraries])

  const loadRegistry = useCallback(async (): Promise<void> => {
    setRegistryLoading(true)
    setNote(null)
    try {
      const reg = await window.api.parts.fetchRegistry()
      setRegistry(reg.libraries)
      if (reg.libraries.length === 0) {
        setNote('No libraries found in the registry (or it could not be reached).')
      }
    } catch {
      setRegistry([])
      setNote('Could not reach the parts registry.')
    } finally {
      setRegistryLoading(false)
    }
  }, [])

  const onToggleRegistry = (): void => {
    const next = !showRegistry
    setShowRegistry(next)
    if (next && registry === null) void loadRegistry()
  }

  const install = async (entry: RegistryEntry): Promise<void> => {
    setBusyLib(entry.id)
    setNote(null)
    try {
      const res = await window.api.parts.installLibrary(entry)
      if (res.ok) {
        setNote(`Installed "${entry.name}".`)
        await refresh()
      } else {
        setNote(res.error ?? `Could not install "${entry.name}".`)
      }
    } finally {
      setBusyLib(null)
    }
  }

  const deletePart = async (libraryId: string, part: PartDefinition): Promise<void> => {
    if (!window.confirm(`Delete the part "${part.name}"? This cannot be undone.`)) return
    await window.api.parts.deletePart(libraryId, part.id)
    if (selected?.partId === part.id) setSelected(null)
    await refresh()
  }

  // Copy a part (with a fresh, unique id + name) into the same library and open
  // the copy in the Part Editor — the quick way to spin up a near-identical board
  // (e.g. the Pico family) without redrawing it.
  const duplicatePart = async (libraryId: string, part: PartDefinition): Promise<void> => {
    const lib = libraries.find((l) => l.id === libraryId)
    const ids = new Set((lib?.parts ?? []).map((p) => p.id))
    const names = new Set((lib?.parts ?? []).map((p) => p.name))
    const baseId = part.id.replace(/-copy(-\d+)?$/, '')
    const baseName = part.name.replace(/ copy( \d+)?$/, '')
    let id = `${baseId}-copy`
    let name = `${baseName} copy`
    for (let n = 2; ids.has(id) || names.has(name); n++) {
      id = `${baseId}-copy-${n}`
      name = `${baseName} copy ${n}`
    }
    const copy: PartDefinition = { ...part, id, name }
    const res = await window.api.parts.savePart(libraryId, copy)
    if (res.ok) {
      setNote(`Duplicated "${part.name}" → "${name}".`)
      await refresh()
      setSelected({ libraryId, partId: id })
      openEditor(libraryId, copy) // jump straight into renaming/tweaking the copy
    } else {
      setNote(res.error ?? 'Duplicate failed.')
    }
  }

  const deleteLibrary = async (lib: PartLibrary): Promise<void> => {
    if (!window.confirm(`Delete the whole library "${lib.name}" and all its parts?`)) return
    await window.api.parts.deleteLibrary(lib.id)
    await refresh()
  }

  const updatableById = useMemo(() => {
    const m = new Map<string, LibraryUpdate>()
    for (const u of updates) m.set(u.id, u)
    return m
  }, [updates])

  // Show the user's OWN library ("My Parts") first so it's the obvious home for
  // anything they create.
  const orderedLibraries = useMemo(
    () =>
      [...libraries].sort((a, b) =>
        a.id === LOCAL_LIBRARY_ID ? -1 : b.id === LOCAL_LIBRARY_ID ? 1 : 0
      ),
    [libraries]
  )

  return (
    <div className="pl">
      <div className="pl__toolbar">
        <button
          type="button"
          className="pl__btn pl__btn--primary"
          onClick={() => openEditor('my-parts', null)}
          title="Author a new part in the Part Editor"
        >
          + New part
        </button>
        <button type="button" className="pl__btn" onClick={onToggleRegistry} title="Browse community libraries">
          {showRegistry ? 'Hide registry' : 'Add library'}
        </button>
        <button
          type="button"
          className="pl__btn pl__btn--icon"
          onClick={() => {
            setNote(null)
            // Parts are read fresh from disk on every list call, so this picks up
            // on-disk edits with no app restart; the shared event also reloads the
            // board graph in this window.
            window.dispatchEvent(new Event(PARTS_CHANGED_EVENT))
          }}
          title="Reload parts from disk (no restart needed)"
          aria-label="Reload parts from disk"
        >
          {actionIcon('refresh')}
        </button>
        <button
          type="button"
          className="pl__btn pl__btn--icon"
          onClick={() => void window.api.parts.openPartsFolder()}
          title="Reveal the parts folder"
          aria-label="Reveal the parts folder"
        >
          {actionIcon('folder')}
        </button>
      </div>

      <div className="pl__search">
        <input
          className="pl__search-input"
          type="text"
          value={query}
          placeholder="Search parts (name, tag, family…)"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search parts"
        />
      </div>

      {note && <p className="pl__note">{note}</p>}

      {/* Registry browser */}
      {showRegistry && (
        <div className="pl__registry">
          <div className="pl__reg-head">
            <span>Community registry</span>
            <button type="button" className="pl__link" onClick={() => void loadRegistry()} disabled={registryLoading}>
              {registryLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {registry && registry.length > 0 ? (
            availableToInstall(libraries, { libraries: registry }).map((entry) => (
              <div className="pl__reg-item" key={entry.id}>
                <div className="pl__reg-meta">
                  <span className="pl__reg-name">{entry.name}</span>
                  <span className="pl__reg-ver">v{entry.version}</span>
                  {entry.description && <span className="pl__reg-desc">{entry.description}</span>}
                </div>
                <button
                  type="button"
                  className="pl__btn pl__btn--small"
                  onClick={() => void install(entry)}
                  disabled={busyLib === entry.id}
                >
                  {busyLib === entry.id ? 'Installing…' : 'Install'}
                </button>
              </div>
            ))
          ) : registryLoading ? (
            <p className="pl__muted">Loading registry…</p>
          ) : (
            <p className="pl__muted">
              All registry libraries are installed, or none were found.{' '}
              <button type="button" className="pl__link" onClick={() => void loadRegistry()}>
                Retry
              </button>
            </p>
          )}
        </div>
      )}

      {/* Installed libraries + parts (top) and the part preview (bottom), with a
          draggable splitter between them. */}
      <PanelGroup direction="vertical" autoSaveId="snakie.parts.split" className="pl__split">
        <Panel id="pl-list" order={1} minSize={20} defaultSize={60}>
          <div className="pl__list">
        {loading && <p className="pl__muted">Loading libraries…</p>}
        {!loading && libraries.length === 0 && (
          <div className="pl__empty">
            <p>No parts yet.</p>
            <p className="pl__muted">
              Create one with <strong>+ New part</strong>, or <strong>Add library</strong> from the
              community registry.
            </p>
          </div>
        )}
        {!loading &&
          orderedLibraries.map((lib) => {
            const parts = q ? lib.parts.filter((p) => matches.some((m) => m.libraryId === lib.id && m.part.id === p.id)) : lib.parts
            if (q && parts.length === 0) return null
            const isCollapsed = collapsed[lib.id]
            const update = updatableById.get(lib.id)
            const isLocal = lib.id === LOCAL_LIBRARY_ID
            return (
              <div className={`pl__lib${isLocal ? ' pl__lib--mine' : ''}`} key={lib.id}>
                <div className="pl__lib-head">
                  <button
                    type="button"
                    className="pl__lib-toggle"
                    onClick={() => setCollapsed((c) => ({ ...c, [lib.id]: !c[lib.id] }))}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="pl__caret">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="pl__lib-name">{lib.name}</span>
                    {isLocal && <span className="pl__badge pl__badge--mine">Your library</span>}
                    <span className="pl__lib-count">{lib.parts.length}</span>
                  </button>
                  {update && (
                    <button
                      type="button"
                      className="pl__badge pl__badge--update"
                      title={`Update available: v${update.installed ?? '?'} → v${update.available}`}
                      onClick={() => {
                        const entry = (registry ?? []).find((e) => e.id === lib.id)
                        if (entry) void install(entry)
                        else void loadRegistry().then(() => setShowRegistry(true))
                      }}
                    >
                      ⬆ v{update.available}
                    </button>
                  )}
                  <button
                    type="button"
                    className="pl__icon pl__icon--danger"
                    title="Delete library"
                    onClick={() => void deleteLibrary(lib)}
                  >
                    ✕
                  </button>
                </div>
                {!isCollapsed && (
                  <ul className="pl__parts">
                    {parts.length === 0 && <li className="pl__muted pl__parts-empty">No parts in this library.</li>}
                    {parts.map((part) => (
                      <li
                        key={part.id}
                        className={`pl__part${selected?.libraryId === lib.id && selected?.partId === part.id ? ' is-active' : ''}`}
                      >
                        <button
                          type="button"
                          className="pl__part-btn"
                          onClick={() =>
                            setSelected(
                              selected?.libraryId === lib.id && selected?.partId === part.id
                                ? null
                                : { libraryId: lib.id, partId: part.id }
                            )
                          }
                        >
                          <span className="pl__part-name">{part.name}</span>
                          {part.family && <span className="pl__part-fam">{part.family}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
          </div>
        </Panel>

        {/* Part preview (resizable) — only when a part is selected. */}
        {selectedPart && (
          <>
            <PanelResizeHandle className="pl__resize" />
            <Panel id="pl-detail" order={2} minSize={20} defaultSize={40}>
              <PartDetail
                libraryId={selectedPart.libraryId}
                part={selectedPart.part}
                onEdit={() => openEditor(selectedPart.libraryId, selectedPart.part)}
                onDuplicate={() => void duplicatePart(selectedPart.libraryId, selectedPart.part)}
                onDelete={() => void deletePart(selectedPart.libraryId, selectedPart.part)}
                onAddToProject={
                  onAddToProject ? () => onAddToProject(selectedPart.libraryId, selectedPart.part) : undefined
                }
                onPromote={
                  // DEV-only: a Microcontroller part that isn't already the standard one.
                  import.meta.env.DEV &&
                  (selectedPart.part.family ?? '').trim().toLowerCase() === 'microcontroller' &&
                  selectedPart.libraryId !== STANDARD_LIBRARY_ID
                    ? () => void promote(selectedPart.libraryId, selectedPart.part)
                    : undefined
                }
                promoteLabel={
                  libraries.some(
                    (l) => l.id === STANDARD_LIBRARY_ID && l.parts.some((p) => p.id === selectedPart.part.id)
                  )
                    ? 'Update Standard'
                    : 'Promote to Standard'
                }
                onClose={() => setSelected(null)}
              />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  )
}

/** The detail card for a selected part: footprint + metadata + pinout table. */
function PartDetail({
  part,
  onEdit,
  onDuplicate,
  onDelete,
  onAddToProject,
  onPromote,
  promoteLabel,
  onClose
}: {
  libraryId: string
  part: PartDefinition
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onAddToProject?: () => void
  /** DEV-only: promote this microcontroller board into the Standard Boards library. */
  onPromote?: () => void
  promoteLabel?: string
  onClose: () => void
}): JSX.Element {
  const [previewMode, setPreviewMode] = useState<'board' | 'schematic'>('board')
  const metaRows: [string, string | undefined][] = [
    ['Manufacturer', part.manufacturer],
    ['Family', part.family],
    ['Package', part.package],
    ['Voltage', part.voltage],
    ['Part #', part.partNumber],
    ['Pin spacing', part.pinSpacing ? `${part.pinSpacing}mm` : undefined],
    ['Dimensions', part.dimensions ? `${part.dimensions.width}×${part.dimensions.height}mm` : undefined],
    ['Version', part.version]
  ]
  const pins = (part.headers ?? []).flatMap((h) => h.pins)

  return (
    <div className="pl__detail">
      <div className="pl__detail-head">
        <div className="pl__detail-titlerow">
          <span className="pl__detail-title">{part.name}</span>
          <button type="button" className="pl__icon" onClick={onClose} title="Close detail">
            ✕
          </button>
        </div>
        <div className="pl__detail-actions">
          {onAddToProject && (
            <button type="button" className="pl__btn pl__btn--small pl__btn--primary" onClick={onAddToProject} title="Add this part to the project (robot.yml)">
              + Add to project
            </button>
          )}
          <button type="button" className="pl__icon pl__icon--action" onClick={onEdit} title="Edit part" aria-label="Edit part">
            {actionIcon('edit')}
          </button>
          <button type="button" className="pl__icon pl__icon--action" onClick={onDuplicate} title="Duplicate part" aria-label="Duplicate part">
            {actionIcon('duplicate')}
          </button>
          {onPromote && (
            <button
              type="button"
              className="pl__icon pl__icon--action"
              onClick={onPromote}
              title={`${promoteLabel ?? 'Promote to Standard'} (developer)`}
              aria-label={`${promoteLabel ?? 'Promote to Standard'} (developer)`}
            >
              {actionIcon('promote')}
            </button>
          )}
          <button
            type="button"
            className="pl__icon pl__icon--action pl__icon--danger"
            onClick={onDelete}
            title="Delete part"
            aria-label="Delete part"
          >
            {actionIcon('delete')}
          </button>
        </div>
      </div>

      {part.description && <p className="pl__detail-desc">{part.description}</p>}

      <div className="pl__detail-seg" role="tablist" aria-label="Preview">
        <button
          type="button"
          role="tab"
          aria-selected={previewMode === 'board'}
          className={`pl__seg-btn${previewMode === 'board' ? ' is-active' : ''}`}
          onClick={() => setPreviewMode('board')}
        >
          Board
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={previewMode === 'schematic'}
          className={`pl__seg-btn${previewMode === 'schematic' ? ' is-active' : ''}`}
          onClick={() => setPreviewMode('schematic')}
        >
          Schematic
        </button>
      </div>
      <div className="pl__detail-fp">
        {previewMode === 'board' ? (
          <PartCanvas part={part} readOnly />
        ) : (
          <PartSchematicView part={part} />
        )}
      </div>

      <dl className="pl__meta">
        {metaRows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div className="pl__meta-row" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        {(part.tags ?? []).length > 0 && (
          <div className="pl__meta-row">
            <dt>Tags</dt>
            <dd className="pl__tags">
              {part.tags!.map((t) => (
                <span className="pl__tag" key={t}>
                  {t}
                </span>
              ))}
            </dd>
          </div>
        )}
        {part.library && (part.library.module || part.library.docs) && (
          <div className="pl__meta-row">
            <dt>Library</dt>
            <dd>
              {part.library.module && <code className="pl__pin-name">{part.library.module}</code>}
              {part.library.docs && (
                <a className="pl__doclink" href={part.library.docs} target="_blank" rel="noreferrer">
                  docs ↗
                </a>
              )}
            </dd>
          </div>
        )}
      </dl>

      <h4 className="pl__pinout-h">Pinout</h4>
      <table className="pl__pinout">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Type</th>
            <th>GPIO</th>
            <th>Capabilities</th>
          </tr>
        </thead>
        <tbody>
          {pins.map((p, i) => (
            <tr key={i}>
              <td>{p.number ?? ''}</td>
              <td className="pl__pin-name">{p.name}</td>
              <td>{p.type}</td>
              <td>{p.type === 'io' && p.gpio != null ? p.gpio : ''}</td>
              <td className="pl__pin-caps">{(p.capabilities ?? []).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
