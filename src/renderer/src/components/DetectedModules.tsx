import { useCallback, useEffect, useMemo, useState } from 'react'
import './DetectedModules.css'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { FILE_SAVED_EVENT, useWorkspace } from '../store/workspace'
import {
  memberCount,
  scanDeviceModules,
  scanProjectModules,
  unscannedDeviceNames,
  type DetectedModule,
  type DetectedOrigin
} from '../lib/module-scan'
import type { ApiClass, ApiFunction, ApiParam } from '../lib/blocks/module-api'
import { describeFirmware, firmwareOnlyNames } from '../../../shared/module-discovery'
import { refreshDiscoveredModules, useDiscoveredModules } from '../hooks/useDiscoveredModules'

/**
 * DETECTED MODULES — what is actually on the board and in the folder.
 * =============================================================================
 *
 * The catalog half of the Modules shelf says what Snakie CAN install. This
 * section says what is THERE: every `.py` at the top of the open project folder
 * and in the board's `/` and `/lib`, each opened up to show the classes (with
 * their methods), functions, constants and variables it defines. Text-only —
 * `readModuleApi` never executes a file — so a driver of unknown provenance is
 * safe to inspect.
 *
 * AND A THIRD PLACE, which no file listing can reach: the FIRMWARE (#1246).
 * A vendor image bakes modules into the binary — an Arduino Alvik's MicroPython
 * carries `arduino_alvik`, `ucPack` and a frozen `modulino` — and they are not
 * files, so `/` and `/lib` are empty of them and the learner is left with an
 * import that works and a panel that says the module doesn't exist. Those come
 * from `help('modules')` via the shared discovery probe.
 *
 * The firmware rows are HONESTLY THINNER than the file rows, and say so. There
 * is no source to parse, so expanding one runs `dir()` on the board: names
 * only, no signatures — freezing discards them — and no way to tell a class
 * from a function. A firmware module cannot be opened in the editor either, so
 * those rows have no OPEN button.
 *
 * RE-SCANNED when it could have changed: a board connects, a file is saved, a
 * driver is installed from any window (`modules.onChanged`), or the folder is
 * re-rooted. And on demand, because a file copied in from Finder is none of
 * those.
 *
 * Both scans run in the background and degrade to an empty list. No folder, no
 * board, a read that fails: each is an ordinary state with its own line, never
 * an error the learner has to dismiss.
 */

/**
 * The shelf's three subcategories, named for WHERE a module lives, because
 * where it lives is what decides what you can do with it: one on the computer
 * is yours to edit, one on the device is yours to open and replace, and one in
 * the firmware is neither.
 */
const ORIGIN_TITLE: Record<DetectedOrigin, string> = {
  project: 'Modules on computer',
  device: 'Modules on device'
}

/** The third subcategory, which has no files behind it and so no scan. */
const FIRMWARE_TITLE = 'Modules in firmware'

/** `(width, height, addr=0x3C, *args)` — a signature as the file wrote it. */
function signature(params: readonly ApiParam[]): string {
  return params
    .map((p) => {
      const star = p.variadic ? '*' : ''
      return p.default !== undefined ? `${star}${p.name}=${p.default}` : `${star}${p.name}`
    })
    .join(', ')
}

function FunctionRow({ fn, method }: { fn: ApiFunction; method?: boolean }): JSX.Element {
  return (
    <li className={`dmods__member dmods__member--${method ? 'method' : 'function'}`}>
      <span className="dmods__kind" aria-hidden="true">
        {method ? 'meth' : 'def'}
      </span>
      <code className="dmods__sig">
        {fn.name}({signature(fn.params)})
      </code>
    </li>
  )
}

function ClassRow({ cls }: { cls: ApiClass }): JSX.Element {
  return (
    <li className="dmods__member dmods__member--class">
      <div className="dmods__line">
        <span className="dmods__kind" aria-hidden="true">
          class
        </span>
        <code className="dmods__sig">
          {cls.name}
          {cls.bases.length > 0 && <span className="dmods__bases">({cls.bases.join(', ')})</span>}
          {cls.init && <span className="dmods__init"> · __init__({signature(cls.init)})</span>}
        </code>
      </div>
      {cls.methods.length > 0 && (
        <ul className="dmods__members dmods__members--nested" role="list">
          {cls.methods.map((m) => (
            <FunctionRow key={m.name} fn={m} method />
          ))}
        </ul>
      )}
    </li>
  )
}

function NameRow({ name, kind }: { name: string; kind: 'const' | 'var' }): JSX.Element {
  return (
    <li className={`dmods__member dmods__member--${kind}`}>
      <span className="dmods__kind" aria-hidden="true">
        {kind}
      </span>
      <code className="dmods__sig">{name}</code>
    </li>
  )
}

/** Human-readable byte count for the row's size badge. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
}

function ModuleRow({
  row,
  onOpen
}: {
  row: DetectedModule
  onOpen: (row: DetectedModule) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const count = memberCount(row.api)
  const api = row.api
  const empty = api && count === 0
  return (
    <li className="dmods__file">
      <div className="dmods__file-head">
        <button
          type="button"
          className="dmods__toggle"
          aria-expanded={open}
          disabled={!api}
          onClick={() => setOpen((v) => !v)}
          title={api ? (open ? 'Hide contents' : 'Show contents') : undefined}
        >
          <span className="dmods__chevron" aria-hidden="true">
            {api ? (open ? '▾' : '▸') : '·'}
          </span>
          <span className="dmods__name">{row.name}</span>
          <span className="dmods__import">import {row.name}</span>
        </button>
        <span className="dmods__meta">
          {row.skipped === 'too-large' && (
            <span className="dmods__skipped" title="Too big to read for its contents">
              too large
            </span>
          )}
          {row.skipped === 'unreadable' && (
            <span className="dmods__skipped" title="The file could not be read">
              unreadable
            </span>
          )}
          {api && (
            <span className="dmods__count" title="Classes, functions, constants and variables">
              {count}
            </span>
          )}
          {row.size !== undefined && <span className="dmods__size">{formatSize(row.size)}</span>}
          <button
            type="button"
            className="dmods__open"
            title={`Open ${row.path} in the editor`}
            onClick={() => onOpen(row)}
          >
            OPEN
          </button>
        </span>
      </div>
      {open && api && (
        <div className="dmods__body">
          {empty ? (
            <p className="dmods__empty">No classes, functions, constants or variables found.</p>
          ) : (
            <ul className="dmods__members" role="list">
              {api.classes.map((c) => (
                <ClassRow key={`c:${c.name}`} cls={c} />
              ))}
              {api.functions.map((f) => (
                <FunctionRow key={`f:${f.name}`} fn={f} />
              ))}
              {api.constants.map((n) => (
                <NameRow key={`k:${n}`} name={n} kind="const" />
              ))}
              {api.variables.map((n) => (
                <NameRow key={`v:${n}`} name={n} kind="var" />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * One module known only by NAME — because it is in the firmware, or because it
 * is a package / `.mpy` / off-path module the file scan cannot read (#1254).
 *
 * Expanding it asks the board for `dir()`, which is the only way in when there
 * is no single source file to parse, and the result is a flat list of names. No
 * signatures, no docstrings, no class/function split: none of that survives
 * freezing, and none of it is recovered by `dir()` either. The row says so
 * rather than inventing structure it does not have.
 *
 * Fetched once, lazily. A vendor package can be large and the import costs the
 * board memory, so nothing is imported until the learner asks for this one.
 */
function BoardModuleRow({
  name,
  submodules,
  badge,
  badgeTitle
}: {
  name: string
  submodules: string[]
  badge: string
  badgeTitle: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = useCallback((): void => {
    setOpen((was) => {
      const next = !was
      if (next && members === null && !loading) {
        setLoading(true)
        void window.api.modules
          .moduleMembers(name)
          .catch(() => [])
          .then((found) => {
            setMembers(found)
            setLoading(false)
          })
      }
      return next
    })
  }, [name, members, loading])

  return (
    <li className="dmods__file">
      <div className="dmods__file-head">
        <button
          type="button"
          className="dmods__toggle"
          aria-expanded={open}
          onClick={toggle}
          title={open ? 'Hide contents' : 'Ask the board what this module offers'}
        >
          <span className="dmods__chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="dmods__name">{name}</span>
          <span className="dmods__import">import {name}</span>
        </button>
        <span className="dmods__meta">
          {submodules.length > 0 && (
            <span
              className="dmods__count"
              title={`Sub-modules: ${submodules.join(', ')}`}
            >
              {submodules.length} sub
            </span>
          )}
          <span className="dmods__frozen" title={badgeTitle}>
            {badge}
          </span>
        </span>
      </div>
      {open && (
        <div className="dmods__body">
          {loading ? (
            <p className="dmods__empty">Asking the board…</p>
          ) : members && members.length > 0 ? (
            <>
              <ul className="dmods__members" role="list">
                {members.map((m) => (
                  <NameRow key={`m:${m}`} name={m} kind="const" />
                ))}
              </ul>
              <p className="dmods__frozen-note">
                Names only — a frozen module keeps no source, so signatures and
                docstrings are gone.
              </p>
            </>
          ) : (
            <p className="dmods__empty">
              {members
                ? 'Nothing to show — the board offered no public names.'
                : 'The board could not be asked just now.'}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

interface ScanState {
  rows: DetectedModule[]
  scanning: boolean
}

const IDLE: ScanState = { rows: [], scanning: false }

export function DetectedModules(): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  const { currentFolder, openFile } = useWorkspace()

  const [project, setProject] = useState<ScanState>(IDLE)
  const [device, setDevice] = useState<ScanState>(IDLE)
  // Bumped by every "it may have changed" signal; the effects below key on it.
  const [projectTick, setProjectTick] = useState(0)
  const [deviceTick, setDeviceTick] = useState(0)

  // --- The folder ---------------------------------------------------------
  useEffect(() => {
    if (!currentFolder || !window.api?.fs?.readDir) {
      setProject(IDLE)
      return
    }
    let live = true
    setProject((s) => ({ ...s, scanning: true }))
    void scanProjectModules(currentFolder, {
      list: (path) => window.api.fs.readDir(path),
      read: (path) => window.api.fs.readFile(path)
    }).then((rows) => {
      if (live) setProject({ rows, scanning: false })
    })
    return () => {
      live = false
    }
  }, [currentFolder, projectTick])

  // A save into the open folder (a new driver written, an edit to one) is the
  // commonest way its contents change.
  useEffect(() => {
    const onSaved = (e: Event): void => {
      const detail = (e as CustomEvent<{ source: string; path: string }>).detail
      if (detail?.source === 'local' && /\.py$/i.test(detail.path)) {
        setProjectTick((t) => t + 1)
      }
      if (detail?.source === 'device' && /\.py$/i.test(detail.path)) {
        setDeviceTick((t) => t + 1)
      }
    }
    window.addEventListener(FILE_SAVED_EVENT, onSaved)
    return () => window.removeEventListener(FILE_SAVED_EVENT, onSaved)
  }, [])

  // --- The board ----------------------------------------------------------
  useEffect(() => {
    if (!connected || !window.api?.device?.listDir) {
      setDevice(IDLE)
      return
    }
    let live = true
    setDevice((s) => ({ ...s, scanning: true }))
    void scanDeviceModules({
      list: (path) => window.api.device.listDir(path),
      read: (path) => window.api.device.readFile(path)
    }).then((rows) => {
      if (live) setDevice({ rows, scanning: false })
    })
    return () => {
      live = false
    }
  }, [connected, deviceTick])

  // A driver installed from any window (the catalog below, the Board View's
  // banner) lands on the board without a save event.
  useEffect(() => {
    const off = window.api?.modules?.onChanged?.(() => setDeviceTick((t) => t + 1))
    return () => off?.()
  }, [])

  // --- The firmware -------------------------------------------------------
  // Shared with the catalog above, so connecting a board asks this question
  // once rather than once per panel.
  const discovery = useDiscoveredModules(connected)
  const firmwareNames = useMemo(() => firmwareOnlyNames(discovery.found), [discovery.found])
  const firmwareLabel = useMemo(
    () => describeFirmware(discovery.found.firmware),
    [discovery.found.firmware]
  )
  // `arduino_alvik.constants` → listed under `arduino_alvik`.
  const submodulesByPackage = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const dotted of discovery.found.frozenSubmodules) {
      const head = dotted.split('.')[0]
      const list = map.get(head)
      if (list) list.push(dotted)
      else map.set(head, [dotted])
    }
    return map
  }, [discovery.found.frozenSubmodules])

  // The importable names on `sys.path` that the file scan could not account
  // for: packages, `.mpy`s, and anything outside `/` and `/lib` (#1254). An
  // Alvik's `arduino_alvik` is a `/lib` PACKAGE, so the `.py`-files-only scan
  // saw nothing and the panel said the board had nothing on it.
  const deviceExtras = useMemo(
    () => unscannedDeviceNames(discovery.found.filesystem, device.rows),
    [discovery.found.filesystem, device.rows]
  )

  const rescan = useCallback((): void => {
    setProjectTick((t) => t + 1)
    setDeviceTick((t) => t + 1)
    refreshDiscoveredModules(connected)
  }, [connected])

  const open = useCallback(
    (row: DetectedModule): void => {
      void openFile(row.origin === 'project' ? 'local' : 'device', row.path).catch(() => {
        // The tab shows its own error state; nothing to add here.
      })
    },
    [openFile]
  )

  const scanning = project.scanning || device.scanning || discovery.scanning

  const renderGroup = (
    origin: DetectedOrigin,
    state: ScanState,
    absent: string | null,
    // Importable names the file scan could not read (#1254) — listed by name
    // beside the parsed files rather than left out of the panel entirely.
    extras: string[] = []
  ): JSX.Element => {
    const total = state.rows.length + extras.length
    return (
      <section className="dmods__group">
        <div className="dmods__group-head">
          <span>{ORIGIN_TITLE[origin]}</span>
          {!absent && (
            <span className="dmods__group-count">
              {total} {total === 1 ? 'module' : 'modules'}
            </span>
          )}
        </div>
        {absent ? (
          <p className="dmods__hint">{absent}</p>
        ) : total === 0 ? (
          <p className="dmods__hint">
            {state.scanning ? 'Looking for modules…' : 'No modules here.'}
          </p>
        ) : (
          <ul className="dmods__files" role="list">
            {state.rows.map((row) => (
              <ModuleRow key={`${row.origin}:${row.path}`} row={row} onOpen={open} />
            ))}
            {extras.map((name) => (
              <BoardModuleRow
                key={`extra:${name}`}
                name={name}
                submodules={[]}
                badge="package"
                badgeTitle="A package, a .mpy, or a module outside / and /lib — importable, but not a single file to read"
              />
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <div className="dmods">
      <div className="dmods__header">
        <span className="dmods__title">DETECTED</span>
        <span className="dmods__actions">
          {scanning && <span className="dmods__scanning">scanning…</span>}
          <button
            type="button"
            className="dmods__rescan"
            onClick={rescan}
            disabled={scanning}
            title="Look again at the folder and the board"
          >
            RESCAN
          </button>
        </span>
      </div>
      <p className="dmods__blurb">
        Every module beside your program and on the board, and what each one defines —
        read from the text, never run. Packages and <code>.mpy</code> files are listed by
        name, and so are the modules compiled into the board&rsquo;s own firmware, which
        are not files at all.
      </p>
      {renderGroup(
        'project',
        project,
        currentFolder ? null : 'Open a folder to see the modules beside your program.'
      )}
      {renderGroup(
        'device',
        device,
        connected ? null : 'Connect a board to see the modules installed on it.',
        deviceExtras
      )}
      <section className="dmods__group">
        <div className="dmods__group-head">
          <span>{FIRMWARE_TITLE}</span>
          {connected && firmwareNames.length > 0 && (
            <span className="dmods__group-count">
              {firmwareNames.length} {firmwareNames.length === 1 ? 'module' : 'modules'}
            </span>
          )}
        </div>
        {!connected ? (
          <p className="dmods__hint">
            Connect a board to see the modules baked into its MicroPython build.
          </p>
        ) : firmwareNames.length === 0 ? (
          <p className="dmods__hint">
            {discovery.scanning
              ? 'Asking the board…'
              : discovery.found.complete
                ? 'The board listed no built-in modules.'
                : // NOT the same sentence (#1254): an unanswered probe that
                  // says "no built-in modules" is indistinguishable from a bare
                  // board, and sends you looking in the wrong place.
                  'The board could not be asked just now — it may have been busy. Press RESCAN.'}
          </p>
        ) : (
          <>
            {firmwareLabel && <p className="dmods__firmware">{firmwareLabel}</p>}
            <ul className="dmods__files" role="list">
              {firmwareNames.map((name) => (
                <BoardModuleRow
                  key={`fw:${name}`}
                  name={name}
                  submodules={submodulesByPackage.get(name) ?? []}
                  badge="built in"
                  badgeTitle="Compiled into the board's firmware"
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
