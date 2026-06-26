import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { PartCanvas } from './PartCanvas'
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

/** Window CustomEvent that asks AppShell to open the Part Editor overlay. */
export const OPEN_PART_EDITOR_EVENT = 'snakie:open-part-editor'
/** Window CustomEvent AppShell fires after the editor saves/closes → refresh. */
export const PARTS_CHANGED_EVENT = 'snakie:parts-changed'

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

export function PartsPanel(): JSX.Element {
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
          className="pl__btn"
          onClick={() => void window.api.parts.openPartsFolder()}
          title="Reveal the parts folder"
        >
          📁
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

      {/* Installed libraries + parts */}
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
          libraries.map((lib) => {
            const parts = q ? lib.parts.filter((p) => matches.some((m) => m.libraryId === lib.id && m.part.id === p.id)) : lib.parts
            if (q && parts.length === 0) return null
            const isCollapsed = collapsed[lib.id]
            const update = updatableById.get(lib.id)
            return (
              <div className="pl__lib" key={lib.id}>
                <div className="pl__lib-head">
                  <button
                    type="button"
                    className="pl__lib-toggle"
                    onClick={() => setCollapsed((c) => ({ ...c, [lib.id]: !c[lib.id] }))}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="pl__caret">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="pl__lib-name">{lib.name}</span>
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

      {/* Part detail */}
      {selectedPart && (
        <PartDetail
          libraryId={selectedPart.libraryId}
          part={selectedPart.part}
          onEdit={() => openEditor(selectedPart.libraryId, selectedPart.part)}
          onDelete={() => void deletePart(selectedPart.libraryId, selectedPart.part)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

/** The detail card for a selected part: footprint + metadata + pinout table. */
function PartDetail({
  part,
  onEdit,
  onDelete,
  onClose
}: {
  libraryId: string
  part: PartDefinition
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}): JSX.Element {
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
        <span className="pl__detail-title">{part.name}</span>
        <div className="pl__detail-actions">
          <button type="button" className="pl__btn pl__btn--small" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="pl__btn pl__btn--small pl__btn--danger" onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="pl__icon" onClick={onClose} title="Close detail">
            ✕
          </button>
        </div>
      </div>

      {part.description && <p className="pl__detail-desc">{part.description}</p>}

      <div className="pl__detail-fp">
        <PartCanvas part={part} readOnly showImage />
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
