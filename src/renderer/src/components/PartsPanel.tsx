import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { CollapsiblePanel } from './CollapsiblePanel'
import { PartCanvas } from './PartCanvas'
import { partHasRear } from '../../../shared/part'
import type { PartSide } from '../../../shared/part'
import { PartSchematicView } from './PartSchematicView'
import { groupByCategory } from './part-categories'
import { applyFilters, emptySelection } from './part-facets'
import { PartCatalog } from './PartCatalog'
import { encodePartDrag } from './part-drag'
import { availableToInstall } from '../../../shared/part-registry'
import type { BundledPartStatus } from '../../../shared/bundled-seed'
import { moduleById, type ModuleDef } from '../../../shared/modules-catalog'
import type { SuggestedModule } from '../../../shared/part'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
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

type IconName = 'edit' | 'duplicate' | 'promote' | 'delete' | 'refresh' | 'folder' | 'expand'

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
  ),
  // Expand to full screen (diagonal arrows out of the corners).
  expand: (
    <path
      d="M6 2.5H3a.5.5 0 0 0-.5.5v3M10 2.5h3a.5.5 0 0 1 .5.5v3M6 13.5H3a.5.5 0 0 1-.5-.5v-3M10 13.5h3a.5.5 0 0 0 .5-.5v-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
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
  /** Batch add from the full-screen catalog (#613). When provided, the panel
   *  header shows a button that expands the library into the catalog. */
  onAddManyToProject?: (items: { libraryId: string; part: PartDefinition }[]) => void
}

export function PartsPanel({ onAddToProject, onAddManyToProject }: PartsPanelProps = {}): JSX.Element {
  const [catalogOpen, setCatalogOpen] = useState(false)
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

  // #643: which bundled parts are user-edited and/or behind the shipped bundle,
  // keyed by part id. An edited part is never refreshed by the seeder, so this is
  // the only thing that makes the staleness visible.
  const [bundled, setBundled] = useState<Record<string, BundledPartStatus>>({})

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
    // Re-read alongside the parts themselves: a save in the Part Editor is exactly
    // what flips a bundled part to "edited".
    try {
      const st = await window.api.parts.bundledStatus()
      setBundled(Object.fromEntries(st.map((s) => [s.id, s])))
    } catch {
      setBundled({})
    }
  }, [])

  /** Bundled parts whose shipped version is newer than the installed copy (#643).
   *  Surfaced as a count on the library header — otherwise a stale part is only
   *  discoverable by selecting it, which is how the last one went unnoticed. */
  const behindParts = useMemo(
    () => Object.values(bundled).filter((s) => s.behind),
    [bundled]
  )

  /** Restore every part that's behind, in one pass. */
  const resetAllBehind = useCallback(async (): Promise<void> => {
    if (behindParts.length === 0) return
    const names = behindParts.map((s) => `  • ${s.name ?? s.id} (${s.localVersion ?? '—'} → ${s.bundledVersion})`)
    const ok = window.confirm(
      `Restore ${behindParts.length} part${behindParts.length === 1 ? '' : 's'} to the bundled version?\n\n` +
        `${names.join('\n')}\n\n` +
        "Each current copy is kept in the library's .backups folder."
    )
    if (!ok) return
    let done = 0
    const failed: string[] = []
    for (const s of behindParts) {
      const res = await window.api.parts.resetToBundled(s.id)
      if (res.ok) done++
      else failed.push(s.name ?? s.id)
    }
    setNote(
      failed.length === 0
        ? `Restored ${done} part${done === 1 ? '' : 's'} to the bundled version. Old copies are in .backups.`
        : `Restored ${done}; could not restore: ${failed.join(', ')}.`
    )
    window.dispatchEvent(new Event(PARTS_CHANGED_EVENT))
    await refresh()
  }, [behindParts, refresh])

  /** Restore a bundled part to the version this app ships (#643). */
  const resetToBundled = useCallback(
    async (part: PartDefinition): Promise<void> => {
      const st = bundled[part.id]
      const ver = st?.bundledVersion ? ` (${st.bundledVersion})` : ''
      const ok = window.confirm(
        `Replace "${part.name}" with the bundled version${ver}?\n\n` +
          'Your current copy — including any image or help file — is kept in the ' +
          'library\'s .backups folder, so this can be undone by hand.'
      )
      if (!ok) return
      const res = await window.api.parts.resetToBundled(part.id)
      setNote(
        res.ok
          ? `"${part.name}" restored to the bundled version. Your copy is in .backups.`
          : (res.error ?? 'Reset failed.')
      )
      if (res.ok) {
        // Other windows (Board View, Part Editor) cache parts too.
        window.dispatchEvent(new Event(PARTS_CHANGED_EVENT))
        await refresh()
      }
    },
    [bundled, refresh]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Re-read after the editor saves/closes (fired by AppShell).
  useEffect(() => {
    const handler = (): void => void refresh()
    window.addEventListener(PARTS_CHANGED_EVENT, handler)
    return () => window.removeEventListener(PARTS_CHANGED_EVENT, handler)
  }, [refresh])

  // DEV: promote (or re-sync) a part into the Standard Boards library. For a part
  // already in Standard this re-writes its runtime copy + mirrors the edit into the
  // bundled repo, so an in-app edit to a shipped part can be committed.
  const promote = useCallback(
    async (libraryId: string, part: PartDefinition): Promise<void> => {
      const res = await window.api.parts.promoteToStandard(libraryId, part.id)
      if (res.ok) {
        const verb = libraryId === STANDARD_LIBRARY_ID ? 'Synced' : 'Promoted'
        const where = libraryId === STANDARD_LIBRARY_ID ? '' : ' to the Standard library'
        setNote(`${verb} "${part.name}"${where}${res.shipped ? ' → bundled repo copy (commit it to ship)' : ''}.`)
        await refresh()
      } else {
        setNote(res.error ?? 'Promote failed.')
      }
    },
    [refresh]
  )

  // Check GitHub (the registry) for newer library versions, including the Standard
  // library (#194). Runs on load and from the Refresh button (#195).
  const checkNow = useCallback(async (): Promise<void> => {
    try {
      const u = await window.api.parts.checkUpdates()
      setUpdates(u.filter((x) => x.updateAvailable))
    } catch {
      // Offline / registry unreachable — leave the last known result.
    }
  }, [])

  // Seed from the main process's on-startup check (#194) for an instant indicator,
  // then re-check live once libraries are known.
  useEffect(() => {
    window.api.parts
      .cachedUpdates()
      .then((u) => setUpdates(u.filter((x) => x.updateAvailable)))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (libraries.length === 0) return
    void checkNow()
  }, [libraries, checkNow])

  // Refresh the library: re-read parts from disk AND re-check GitHub (#195).
  const refreshAll = useCallback((): void => {
    setNote(null)
    // Parts are read fresh from disk on every list call; the shared event also
    // reloads the board graph in this window.
    window.dispatchEvent(new Event(PARTS_CHANGED_EVENT))
    void checkNow()
  }, [checkNow])

  const allParts = useMemo(
    () =>
      libraries.flatMap((lib) =>
        lib.parts.map((part) => ({ libraryId: lib.id, libraryName: lib.name, part }))
      ),
    [libraries]
  )

  const q = query.trim().toLowerCase()
  // Facet filters (#740) — type / manufacturer / tag, ANDed with the text
  // search. Derived from the loaded libraries each render rather than indexed:
  // there is nothing to invalidate, so the counts can't go stale.
  // Facets live in the FULL-SCREEN catalog (#740), which has the room for them;
  // this docked strip filters by the search box alone.
  const matches = useMemo(() => applyFilters(allParts, emptySelection(), q), [allParts, q])

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

  // Pull + apply every available library update right away (#196). Each install
  // is a fresh clone of the registry repo, so the new version is used immediately.
  const updateAll = async (): Promise<void> => {
    const reg = (await window.api.parts.fetchRegistry().catch(() => null))?.libraries ?? registry ?? []
    for (const u of updates) {
      const entry = reg.find((e) => e.id === u.id)
      if (entry) await install(entry)
    }
    await checkNow()
  }

  // DEV: publish the Standard library to GitHub (#197).
  const publishStandard = async (): Promise<void> => {
    setBusyLib(STANDARD_LIBRARY_ID)
    setNote('Publishing the Standard library to GitHub…')
    try {
      const res = await window.api.parts.publishStandard()
      setNote(res.ok ? `Published the Standard library (v${res.version}).` : (res.error ?? 'Publish failed.'))
      if (res.ok) await refresh()
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
          className={`pl__btn pl__btn--icon${updates.length > 0 ? ' pl__btn--has-update' : ''}`}
          onClick={refreshAll}
          title="Refresh library — reload parts from disk and check GitHub for updates"
          aria-label="Refresh library (reload from disk + check for updates)"
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
        {/* Expand the library into the full-screen catalog (#613) — only in a
            project context (the board window), where parts can be added. */}
        {onAddManyToProject && (
          <button
            type="button"
            className="pl__btn pl__btn--icon"
            onClick={() => setCatalogOpen(true)}
            title="Open the full-screen parts catalog"
            aria-label="Open the full-screen parts catalog"
          >
            {actionIcon('expand')}
          </button>
        )}
      </div>

      {catalogOpen && onAddManyToProject && (
        <PartCatalog
          libraries={libraries}
          onClose={() => setCatalogOpen(false)}
          onAddMany={onAddManyToProject}
        />
      )}

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


      {/* Panel status line (reset/promote/install/registry). It persists until the
          next action replaces it, so it needs a way out — otherwise a one-off
          "restored to the bundled version" sits there for the rest of the session. */}
      {note && (
        <div className="pl__note" role="status">
          <span className="pl__note-text">{note}</span>
          <button
            type="button"
            className="pl__icon pl__note-close"
            onClick={() => setNote(null)}
            title="Dismiss"
            aria-label="Dismiss message"
          >
            ✕
          </button>
        </div>
      )}

      {/* Library update indicator (#196) — one click pulls + uses the latest. */}
      {updates.length > 0 && (
        <div className="pl__updates" role="status">
          <span className="pl__updates-text">
            ⬆ {updates.length} library update{updates.length === 1 ? '' : 's'} available
          </span>
          <button type="button" className="pl__link" onClick={() => void updateAll()}>
            Update all
          </button>
        </div>
      )}

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
              // Soft Shell (#579): each library is a CollapsiblePanel — its own
              // header owns the collapse chevron; the part count is the badge and
              // the "your library" / update / publish / delete controls are the
              // header actions (shown when open).
              <CollapsiblePanel
                key={lib.id}
                className={`pl__lib${isLocal ? ' pl__lib--mine' : ''}`}
                title={lib.name}
                open={!isCollapsed}
                onToggle={() => setCollapsed((c) => ({ ...c, [lib.id]: !c[lib.id] }))}
                badge={lib.parts.length}
                actions={
                  <>
                    {isLocal && <span className="pl__badge pl__badge--mine">Your library</span>}
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
                    {/* #643 — how many bundled parts this app ships a newer version
                        of than the installed copy. Click to restore them all. */}
                    {lib.id === STANDARD_LIBRARY_ID && behindParts.length > 0 && (
                      <button
                        type="button"
                        className="pl__badge pl__badge--stale"
                        title={`${behindParts.length} part(s) are older than the bundled version — click to restore them (your copies are backed up)`}
                        onClick={() => void resetAllBehind()}
                      >
                        ↻ {behindParts.length} behind
                      </button>
                    )}
                    {/* DEV-only: publish the Standard library to GitHub (#197). */}
                    {import.meta.env.DEV && lib.id === STANDARD_LIBRARY_ID && (
                      <button
                        type="button"
                        className="pl__badge pl__badge--publish"
                        title="Publish the Standard library to GitHub (developer)"
                        disabled={busyLib === STANDARD_LIBRARY_ID}
                        onClick={() => void publishStandard()}
                      >
                        {busyLib === STANDARD_LIBRARY_ID ? 'Publishing…' : '⇧ Publish'}
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
                  </>
                }
              >
                {parts.length === 0 ? (
                  <p className="pl__muted pl__parts-empty">No parts in this library.</p>
                ) : (
                  // Group the library's parts under category section headers (#193).
                  groupByCategory(parts).map(({ category, items }) => (
                      <div className="pl__cat" key={category}>
                        <div className="pl__cat-head">
                          <span className="pl__cat-name">{category}</span>
                          <span className="pl__cat-count">{items.length}</span>
                        </div>
                        <ul className="pl__parts">
                          {items.map((part) => (
                            <li
                              key={part.id}
                              className={`pl__part${selected?.libraryId === lib.id && selected?.partId === part.id ? ' is-active' : ''}${onAddToProject ? ' pl__part--draggable' : ''}`}
                              // Drag a part straight onto the Board View's wiring
                              // canvas (#159). Only meaningful when the panel can add
                              // to a project (the board dock), so gate on that.
                              draggable={!!onAddToProject}
                              onDragStart={
                                onAddToProject
                                  ? (e) => encodePartDrag(e.dataTransfer, { libraryId: lib.id, partId: part.id })
                                  : undefined
                              }
                              title={onAddToProject ? 'Drag onto the breadboard, or click to preview' : undefined}
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
                              </button>
                              {/* Which parts the ↻ / ⇧ Publish buttons above actually ACT on.
                                  Both were library-wide, so a maintainer could see that
                                  something was behind or unpublished without being told
                                  which. `bundledStatus` already knows per part (#643). */}
                              {(() => {
                                const st =
                                  lib.id === STANDARD_LIBRARY_ID ? bundled[part.id] : undefined
                                if (!st) return null
                                return (
                                  <>
                                    {st.behind && (
                                      <span
                                        className="pl__part-mark pl__part-mark--behind"
                                        title={`Behind the bundled version — yours is ${st.localVersion ?? 'unversioned'}, the app ships ${st.bundledVersion}. Reset it from the part's detail.`}
                                        aria-label={`${part.name} is behind the bundled version`}
                                      >
                                        ↻
                                      </span>
                                    )}
                                    {/* DEV-only: "differs from what ships" is a publishing
                                        concern, and ⇧ Publish is developer-only too. */}
                                    {import.meta.env.DEV && st.edited && !st.behind && (
                                      <span
                                        className="pl__part-mark pl__part-mark--unpublished"
                                        title={`Edited since it was seeded (v${st.localVersion ?? '?'}) — not yet in the bundled library. Publish to ship it.`}
                                        aria-label={`${part.name} has unpublished changes`}
                                      >
                                        ●
                                      </span>
                                    )}
                                  </>
                                )
                              })()}
                              {/* Part-level update hint (#155): the registry tracks versions per
                                  library, so when a part's library has an update we flag the part
                                  too — updating pulls the newest version of this part. */}
                              {update && (
                                <button
                                  type="button"
                                  className="pl__part-update"
                                  title={`Update available (v${update.installed ?? '?'} → v${update.available}) — updates this part via its library`}
                                  aria-label={`Update ${part.name} (via its library)`}
                                  onClick={() => {
                                    const entry = (registry ?? []).find((e) => e.id === lib.id)
                                    if (entry) void install(entry)
                                    else void loadRegistry().then(() => setShowRegistry(true))
                                  }}
                                >
                                  ⬆
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                )}
              </CollapsiblePanel>
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
                  // DEV-only. Any part, INCLUDING one already in the Standard library
                  // — re-promoting a Standard part re-writes its runtime copy and
                  // mirrors the edit into the bundled repo (examples/parts/…) so an
                  // in-app edit to a shipped part can actually be committed + shipped.
                  import.meta.env.DEV
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
                bundledStatus={
                  // Only meaningful for the bundled library — a user's own part has
                  // no bundle to compare against or reset to.
                  selectedPart.libraryId === STANDARD_LIBRARY_ID
                    ? bundled[selectedPart.part.id]
                    : undefined
                }
                onResetToBundled={() => void resetToBundled(selectedPart.part)}
                onClose={() => setSelected(null)}
              />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  )
}

/**
 * "Works with" — the OPTIONAL modules a part can use, and what each unlocks (#638).
 *
 * Deliberately separate from the Board View's driver-install banner, which pushes
 * the drivers a part CANNOT work without. A carrier is a menu: someone using only
 * its Grove ports should never be nagged to install an OLED driver. So this lists,
 * shows what is already on the board, and installs one at a time — on request.
 *
 * Reuses the ordinary module install path (`modules.probeInstalled` / `install`),
 * so "already installed" means the same thing here as in the Modules panel.
 */
function WorksWith({ suggests }: { suggests: SuggestedModule[] }): JSX.Element | null {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState(0)

  // Only rows that resolve to a real catalog module — a typo'd id must not render
  // an install button that cannot work.
  const rows = useMemo(
    () =>
      suggests
        .map((s) => ({ suggest: s, def: moduleById(s.module) }))
        .filter((r): r is { suggest: SuggestedModule; def: ModuleDef } => r.def !== undefined),
    [suggests]
  )

  useEffect(() => {
    if (!connected || rows.length === 0) {
      setInstalled(new Set())
      return
    }
    let active = true
    window.api.modules
      .probeInstalled(rows.map((r) => r.def.importName))
      .then((found) => {
        if (active) setInstalled(new Set(found))
      })
      .catch(() => {
        if (active) setInstalled(new Set())
      })
    return () => {
      active = false
    }
  }, [connected, rows, done])

  const install = useCallback(async (def: ModuleDef): Promise<void> => {
    setBusy(def.id)
    try {
      await window.api.modules.install(def.id)
      setDone((n) => n + 1)
    } catch {
      // The Modules panel is the place with a full install log; here a failure
      // just leaves the row installable rather than throwing at the user.
    } finally {
      setBusy(null)
    }
  }, [])

  if (rows.length === 0) return null

  return (
    <div className="pl__works">
      <div className="pl__works-head">Works with</div>
      <ul className="pl__works-list">
        {rows.map(({ suggest, def }) => {
          const on = installed.has(def.importName)
          return (
            <li className="pl__works-row" key={def.id}>
              <span className="pl__works-name">{def.name}</span>
              <span className="pl__works-unlocks">{suggest.unlocks ?? def.description}</span>
              {on ? (
                <span className="pl__works-on">on board</span>
              ) : (
                <button
                  type="button"
                  className="pl__btn pl__btn--small"
                  disabled={!connected || busy === def.id}
                  title={connected ? `Install ${def.name}` : 'Connect a board to install'}
                  onClick={() => void install(def)}
                >
                  {busy === def.id ? '…' : 'Install'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {!connected && <p className="pl__works-note">Connect a board to install these.</p>}
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
  bundledStatus,
  onResetToBundled,
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
  /** How this copy compares with the bundle the app ships (#643); absent for
   *  parts that aren't bundled. */
  bundledStatus?: BundledPartStatus
  onResetToBundled: () => void
  onClose: () => void
}): JSX.Element {
  const [previewMode, setPreviewMode] = useState<'board' | 'schematic'>('board')
  // Which face the preview shows, and the coin-spin between them. Same shape as
  // the Part Editor's: the side swaps half way, while the board is edge-on.
  const [previewSide, setPreviewSide] = useState<PartSide>('front')
  const [previewFlipping, setPreviewFlipping] = useState(false)
  const flipTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => flipTimers.current.forEach(clearTimeout), [])
  // A different part may not have a back at all — start each one face-up.
  useEffect(() => setPreviewSide('front'), [part.id])
  const flipPreview = (): void => {
    if (previewFlipping) return
    setPreviewFlipping(true)
    flipTimers.current.push(
      setTimeout(() => setPreviewSide((v) => (v === 'front' ? 'rear' : 'front')), 210),
      setTimeout(() => setPreviewFlipping(false), 420)
    )
  }
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

      {part.suggests && part.suggests.length > 0 && <WorksWith suggests={part.suggests} />}

      {/* #643 — an edited bundled part is never refreshed by the seeder, so it can
          sit on an old schema indefinitely. Say so, and offer the way back. The
          `behind` case is the one that actually costs the user something. */}
      {bundledStatus && (bundledStatus.behind || bundledStatus.edited) && (
        <div className={`pl__stale${bundledStatus.behind ? ' pl__stale--behind' : ''}`}>
          <span className="pl__stale-text">
            {bundledStatus.behind ? (
              <>
                Bundled version <strong>{bundledStatus.bundledVersion}</strong> available — yours is{' '}
                <strong>{bundledStatus.localVersion ?? 'unversioned'}</strong>
                {bundledStatus.edited ? ' (edited)' : ''}.
              </>
            ) : (
              <>Edited — this copy no longer tracks the bundled version.</>
            )}
          </span>
          <button
            type="button"
            className="pl__btn pl__btn--small"
            onClick={onResetToBundled}
            title="Replace this part with the version bundled in the app (your copy is backed up)"
          >
            Reset to bundled
          </button>
        </div>
      )}

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
      {/* The mat is the STAGE and stays put; only the board turns on it (#…).
          Flipping the outer box rotated its background and border too, which
          read as the whole viewer tipping over rather than a part being turned
          over in your hands. */}
      <div className="pl__detail-fp">
        <div className={`pl__detail-flip${previewFlipping ? ' is-flipping' : ''}`}>
          {previewMode === 'board' ? (
            <PartCanvas part={part} readOnly side={previewSide} />
          ) : (
            <PartSchematicView part={part} />
          )}
        </div>
      </div>
      {/* Only offered when there IS a back — a single-sided part shouldn't invite
          you to turn it over and find nothing (#636). */}
      {previewMode === 'board' && partHasRear(part) && (
        <button
          type="button"
          className="pl__flip"
          onClick={flipPreview}
          disabled={previewFlipping}
          title={previewSide === 'front' ? 'Show the back of the board' : 'Show the front of the board'}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <ellipse cx="8" cy="8" rx="3" ry="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2.2 4.4A6.6 6.6 0 0 1 8 1.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M13.8 11.6A6.6 6.6 0 0 1 8 14.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M1.2 2.2l1 2.4 2.4-1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14.8 13.8l-1-2.4-2.4 1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{previewSide === 'front' ? 'Flip to back' : 'Flip to front'}</span>
        </button>
      )}

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
