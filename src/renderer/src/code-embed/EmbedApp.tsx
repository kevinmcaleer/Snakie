import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PromptProvider } from '../components/PromptModal'
import { SettingsProvider } from '../store/settings'
import { LayoutProvider } from '../store/layout'
import { WorkspaceProvider, useWorkspace } from '../store/workspace'
import { hasBlocksFooter, stripBlocksFooter } from '../../../shared/blocks-doc'
import { EMBED_PARAMS } from './embed-boot'
import { sliceLines, type EmbedParams, type EmbedView } from './params'
import { EmbedLoadError, githubUrlFor, loadProgram, openInSnakieUrl, type LoadedProgram } from './source'
import { createEngine, type EmbedEngine } from './engines'
import { EmbedTerminal, type EmbedTerminalHandle } from './EmbedTerminal'
import { preferredHeight } from './layout'
import { BUILTIN_BOARDS, DEFAULT_BOARD_ID } from '../components/board-defs'
import { EmbedBoard, type PinLive } from './EmbedBoard'
import { pinsInCode, projectWiring, resolvePin, wiringMismatch, type PinEvent } from './embed-pins'
import { wiredLabel } from '../../../shared/wiring-pins'
import { KR_PROJECTS_API } from '../../../shared/kevsrobots-account'
import type { RobotDefinition } from '../../../shared/robot'
import { GitHubIcon, PlayIcon, ResetIcon, SnakieLogo, StopIcon } from './icons'
// The code pane's header, for CodeFallback before PythonPane (and its CSS) arrives.
import '../components/PythonPane.css'
import './EmbedApp.css'

/** The code pane's header for a file Snakie doesn't run. */
function languageLabel(name: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  const known: Record<string, string> = {
    ino: 'Arduino', cpp: 'C++', cc: 'C++', h: 'C / C++', hpp: 'C++', c: 'C', js: 'JavaScript', ts: 'TypeScript',
    yml: 'YAML', yaml: 'YAML', json: 'JSON', md: 'Markdown', sh: 'Shell', toml: 'TOML', txt: 'Text', html: 'HTML', css: 'CSS'
  }
  return known[ext] ?? (ext ? ext.toUpperCase() : 'Code')
}

// Start fetching the editor now, alongside the program, not once the program has arrived.
const pythonPaneChunk = import('../components/PythonPane')
const PythonPane = lazy(() => pythonPaneChunk)

/**
 * The code, drawn plainly while Monaco (several MB) downloads: same header,
 * same line numbers and line height, so the box is readable at once and the
 * editor arriving changes nothing but the colours.
 */
function CodeFallback({ code, title }: { code: string; title: string }): JSX.Element {
  const lines = code.split('\n')
  return (
    <div className="python-pane snk-embed__plain" aria-busy="true">
      <div className="python-pane__header">
        <span className="python-pane__title">{title}</span>
      </div>
      <pre className="snk-embed__plain-code">
        {lines.map((line, i) => (
          <div key={i} className="snk-embed__plain-line">
            <span className="snk-embed__plain-num" aria-hidden="true">
              {i + 1}
            </span>
            <span>{line || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}
const BlocksSplit = lazy(() => import('../components/BlocksSplit'))

/** Narrower than this and the board would squeeze the code: the pins become a row of chips. */
const BOARD_SIDE_MIN_W = 600

/** The box's own width, so the layout follows the host page's column, not the screen. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/** A board by id, forgiving `pico-2-w` and `Pico2W`. */
function boardFor(id: string | null): string {
  if (!id) return DEFAULT_BOARD_ID
  const want = id.toLowerCase().replace(/[^a-z0-9]/g, '')
  const hit = BUILTIN_BOARDS.find(
    (b) => b.id.toLowerCase().replace(/[^a-z0-9]/g, '') === want || b.name.toLowerCase().replace(/[^a-z0-9]/g, '') === want
  )
  return hit?.id ?? DEFAULT_BOARD_ID
}

/** A pin id as it may cross between frames: short, and nothing but a name. */
/** More files than this and the tabs become a menu. */
const MAX_TABS = 5

const PIN_ID_RE = /^[A-Za-z0-9_]{1,16}$/

/** The last path segment: what a tab calls its file. */
function baseName(path: string): string {
  return path.split('/').pop() || path
}

/** Where "Open in Snakie" goes: this deployment's own app. */
const APP_ORIGIN = window.location.origin

export function EmbedApp({ params = EMBED_PARAMS }: { params?: EmbedParams }): JSX.Element {
  return (
    <PromptProvider>
      <SettingsProvider>
        <LayoutProvider chatPane={false}>
          <WorkspaceProvider>
            <EmbedShell params={params} />
          </WorkspaceProvider>
        </LayoutProvider>
      </SettingsProvider>
    </PromptProvider>
  )
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; program: LoadedProgram; original: string }
  | { kind: 'error'; message: string; githubUrl: string | null }

/** Post to the host page (snakie-embed.js resizes the iframe from this). */
function tellHost(params: EmbedParams, message: Record<string, unknown>): void {
  if (window.parent === window) return
  window.parent.postMessage({ source: 'snakie-embed', id: params.id, ...message }, '*')
}

function EmbedShell({ params }: { params: EmbedParams }): JSX.Element {
  const { openFiles, activeId, openBuffer, closeFile, updateContent } = useWorkspace()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [view, setView] = useState<EmbedView>(params.view ?? 'code')
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)
  const [plots, setPlots] = useState<string[]>([])
  const engine = useMemo<EmbedEngine>(() => createEngine(params.engine, params.packages), [params])
  const termRef = useRef<EmbedTerminalHandle>(null)
  const bootRef = useRef<Promise<void> | null>(null)
  const [boardId, setBoardId] = useState(() => boardFor(params.board))
  const [robot, setRobot] = useState<RobotDefinition | null>(null)
  /** Pins another frame on the page (or the page itself) is pointing at. */
  const [remotePins, setRemotePins] = useState<readonly string[]>([])
  const [live, setLive] = useState<ReadonlyMap<string, PinLive>>(() => new Map())
  const [hoverPin, setHoverPin] = useState<string | null>(null)
  const [focusLine, setFocusLine] = useState<number | null>(null)
  const [revealLine, setRevealLine] = useState<number | null>(null)
  const width = useWindowWidth()
  const boardDef = BUILTIN_BOARDS.find((b) => b.id === boardId) ?? BUILTIN_BOARDS[0]
  const boardRef = useRef(boardDef)
  boardRef.current = boardDef
  // Pin changes arrive far faster than a screen draws: keep the latest of each
  // and paint once a frame.
  const liveQueue = useRef(new Map<string, PinLive>())
  const liveFrame = useRef(0)
  const onPinEvent = useCallback((event: PinEvent): void => {
    const id = resolvePin(event.pin, boardRef.current)?.id
    if (!id) return
    liveQueue.current.set(id, { kind: event.kind, value: event.value })
    if (liveFrame.current) return
    liveFrame.current = requestAnimationFrame(() => {
      liveFrame.current = 0
      const batch = liveQueue.current
      liveQueue.current = new Map()
      setLive((prev) => new Map([...prev, ...batch]))
      // Other frames on the page (a wiring picture, a robot) follow along.
      tellHost(params, { type: 'pin-state', states: Object.fromEntries(batch) })
    })
  }, [params])
  useEffect(() => () => cancelAnimationFrame(liveFrame.current), [])

  // The project's wiring (#1320): public for a published project, so no
  // sign-in. Without it the strip is what it was: pins, no part names.
  useEffect(() => {
    if (!params.project || !params.pins) return
    let cancelled = false
    fetch(`${KR_PROJECTS_API}/api/projects/${params.project}/wiring`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: RobotDefinition } | null) => {
        if (cancelled || !body?.data || !Array.isArray(body.data.connections)) return
        setRobot(body.data)
        // The project's own board, unless the page asked for one.
        if (!params.board && body.data.board) setBoardId(boardFor(body.data.board))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [params.project, params.pins, params.board])

  // Pins the host page points at: a wire hovered in the wiring picture, or a
  // pin in another code frame, relayed by snakie-embed.js. Names only.
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== window.parent || window.parent === window) return
      const data = e.data as { source?: unknown; type?: unknown; pins?: unknown } | null
      if (!data || data.source !== 'snakie-embed-host' || data.type !== 'pin-hover') return
      const pins = Array.isArray(data.pins)
        ? data.pins.filter((p): p is string => typeof p === 'string' && PIN_ID_RE.test(p)).slice(0, 40)
        : []
      setRemotePins(pins)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const file = openFiles.find((f) => f.id === activeId) ?? null
  const content = file?.content ?? ''
  const loadedName = phase.kind === 'ready' ? phase.program.name : ''
  // Only Python runs. A gist of C++ or YAML is shown in the same box, read-only.
  const isPython = loadedName === '' || /\.(py|pyw)$/i.test(loadedName)
  const runnable = params.run && isPython
  const blocksAllowed = params.engine === 'micropython' && isPython

  // Load the program once.
  useEffect(() => {
    let cancelled = false
    loadProgram(params.source, (url) => fetch(url))
      .then((program) => {
        if (cancelled) return
        const code = sliceLines(program.code, params.lines)
        openBuffer(program.name, code)
        if (!params.view && params.engine === 'micropython' && hasBlocksFooter(code)) setView('blocks')
        setPhase({ kind: 'ready', program: { ...program, code }, original: code })
        document.title = `${program.name} · Snakie`
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          githubUrl: err instanceof EmbedLoadError ? err.githubUrl : githubUrlFor(params.source, params.lines)
        })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => engine.dispose(), [engine])

  const boot = useCallback((): Promise<void> => {
    if (!bootRef.current) {
      setStarted(true)
      bootRef.current = engine
        .start({
          output: (text) => termRef.current?.write(text),
          image: (png) => setPlots((p) => [...p, png]),
          ...(params.pins ? { pin: onPinEvent } : {})
        })
        .catch((err: unknown) => {
          bootRef.current = null
          termRef.current?.write(`\r\n\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`)
          throw err
        })
    }
    return bootRef.current
  }, [engine, params.pins, onPinEvent])

  const run = useCallback(async (): Promise<void> => {
    if (running || phase.kind !== 'ready') return
    setRunning(true)
    setPlots([])
    liveQueue.current.clear()
    setLive(new Map())
    try {
      await boot()
      const name = phase.program.name
      termRef.current?.write(`\r\n\x1b[2m# running ${name}\x1b[0m\r\n`)
      await engine.run(stripBlocksFooter(content))
    } catch {
      /* reported in the terminal */
    } finally {
      setRunning(false)
    }
  }, [running, phase, boot, engine, content])

  const stop = useCallback(async (): Promise<void> => {
    await engine.stop()
    setRunning(false)
  }, [engine])

  /** Show another file of a multi-file gist (its original text). */
  const switchFile = useCallback(
    (name: string): void => {
      if (phase.kind !== 'ready' || !file || name === phase.program.name) return
      const next = phase.program.files?.find((f) => f.name === name)
      if (!next) return
      if (running) void stop()
      const code = sliceLines(next.code, params.lines)
      const source =
        phase.program.source.kind === 'gist'
          ? { ...phase.program.source, file: name }
          : phase.program.source.kind === 'repo'
            ? { ...phase.program.source, path: name }
            : phase.program.source
      closeFile(file.id)
      openBuffer(name, code)
      setPlots([])
      setView(params.view ?? (params.engine === 'micropython' && hasBlocksFooter(code) ? 'blocks' : 'code'))
      setPhase({ kind: 'ready', program: { ...phase.program, name, code, source }, original: code })
    },
    [phase, file, running, stop, params, closeFile, openBuffer]
  )

  const reset = useCallback((): void => {
    if (phase.kind !== 'ready' || !file) return
    if (running) void stop()
    closeFile(file.id)
    openBuffer(phase.program.name, phase.original)
    setPlots([])
  }, [phase, file, running, stop, closeFile, openBuffer])

  // Autorun once the file is in the editor.
  const autoran = useRef(false)
  useEffect(() => {
    if (!params.autorun || !runnable || autoran.current || phase.kind !== 'ready' || !file) return
    autoran.current = true
    void run()
  }, [params.autorun, runnable, phase, file, run])

  const edited = phase.kind === 'ready' && file !== null && content !== phase.original

  // The pins this code uses (#1318). No pins, no strip: a lesson about lists
  // looks exactly as it did.
  const program = useMemo(() => stripBlocksFooter(content), [content])
  const codePins = useMemo(
    () => (params.pins && isPython && phase.kind === 'ready' ? pinsInCode(program, boardDef) : null),
    [params.pins, isPython, phase.kind, program, boardDef]
  )
  const boardMode: 'side' | 'chips' | null =
    !codePins || codePins.pins.length === 0 ? null : view === 'code' && width >= BOARD_SIDE_MIN_W ? 'side' : 'chips'
  const wiring = useMemo(() => (robot ? projectWiring(robot, boardDef) : null), [robot, boardDef])
  const wiredNames = useMemo(() => {
    const names = new Map<string, string>()
    if (wiring) for (const [id, wired] of wiring.byPin) names.set(id, wiredLabel(wired))
    return names
  }, [wiring])
  // What this frame itself is pointing at: the hovered pin, or the caret's line.
  const ownPins = useMemo(
    () => (hoverPin ? [hoverPin] : focusLine !== null ? codePins?.byLine.get(focusLine) ?? [] : []),
    [hoverPin, focusLine, codePins]
  )
  const activePins = useMemo(() => new Set([...ownPins, ...remotePins]), [ownPins, remotePins])
  const hoverLines = useMemo(() => {
    const ids = hoverPin ? [hoverPin] : remotePins
    const lines = new Set<number>()
    for (const id of ids) for (const line of codePins?.pins.find((p) => p.id === id)?.lines ?? []) lines.add(line)
    return [...lines].sort((a, b) => a - b)
  }, [hoverPin, remotePins, codePins])

  // Say what we are pointing at, so the page can light the same pin elsewhere.
  const ownKey = ownPins.join(',')
  useEffect(() => {
    tellHost(params, { type: 'pin-hover', pins: ownKey ? ownKey.split(',') : [] })
  }, [params, ownKey])

  // And which pins the code uses, with where it disagrees with the wiring: a
  // project editor shows that as a warning.
  const pinsKey = codePins ? codePins.pins.map((p) => `${p.id}:${p.kind}:${p.onBoard ? 1 : 0}`).join(',') : ''
  useEffect(() => {
    if (!codePins) return
    const mismatch = wiring ? wiringMismatch(codePins.pins, wiring) : null
    tellHost(params, {
      type: 'pins',
      file: loadedName,
      pins: codePins.pins.map((p) => ({ id: p.id, kind: p.kind, onBoard: p.onBoard, part: wiredNames.get(p.id) ?? null })),
      ...(mismatch ? { unwired: mismatch.unwired, unused: mismatch.unused } : {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, pinsKey, wiring, wiredNames, loadedName])
  const pickPin = useCallback(
    (id: string): void => {
      const line = codePins?.pins.find((p) => p.id === id)?.setupLines[0]
      if (line === undefined) return
      setHoverPin(id)
      setRevealLine(line)
    },
    [codePins]
  )

  // Tell the host the box has something to show (the code, or why not), so it
  // can swap its plain block for this frame without a blank moment.
  const toldReady = useRef(false)
  useEffect(() => {
    if (toldReady.current || phase.kind === 'loading') return
    toldReady.current = true
    tellHost(params, { type: 'ready' })
  }, [params, phase.kind])

  // Tell the host how tall we'd like to be.
  useEffect(() => {
    if (params.height !== null) return
    tellHost(params, {
      type: 'height',
      height: preferredHeight({
        lines: phase.kind === 'ready' ? stripBlocksFooter(content).split('\n').length : 6,
        view,
        repl: runnable,
        plots: plots.length > 0,
        error: phase.kind === 'error',
        board: boardMode
      })
    })
  }, [params, phase.kind, content, view, plots.length, runnable, boardMode])

  const githubUrl =
    phase.kind === 'ready' ? githubUrlFor(phase.program.source, params.lines) : phase.kind === 'error' ? phase.githubUrl : null
  const snakieUrl =
    phase.kind === 'ready'
      ? openInSnakieUrl(APP_ORIGIN, phase.program.source, content, phase.program.name, edited)
      : null
  const name = phase.kind === 'ready' ? phase.program.name : ''

  const onTermInput = useCallback(
    (data: string): void => {
      void boot().then(() => engine.input(data)).catch(() => undefined)
    },
    [boot, engine]
  )

  const codeTitle = !isPython ? languageLabel(loadedName) : params.engine === 'pyodide' ? 'Python' : 'MicroPython'
  const showCodePane = (view === 'code' || !blocksAllowed) && file !== null && !file.isBlocks

  return (
    <div className={`snk-embed snk-embed--${view}${runnable ? '' : ' snk-embed--viewer'}`}>
      <header className="snk-embed__bar">
        {phase.kind === 'ready' && phase.program.files && phase.program.files.length <= MAX_TABS ? (
          <div className="snk-embed__tabs" role="tablist" aria-label="Files">
            {phase.program.files.map((f) => (
              <button
                key={f.name}
                type="button"
                role="tab"
                aria-selected={f.name === name}
                className={`snk-embed__tab${f.name === name ? ' is-active' : ''}`}
                title={f.name}
                onClick={() => switchFile(f.name)}
              >
                {baseName(f.name)}
                {f.name === name && edited && <span className="snk-embed__edited">edited</span>}
              </button>
            ))}
          </div>
        ) : phase.kind === 'ready' && phase.program.files ? (
          <span className="snk-embed__name">
            <select
              className="snk-embed__file"
              value={name}
              aria-label="File"
              onChange={(e) => switchFile(e.target.value)}
            >
              {phase.program.files.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}
                </option>
              ))}
            </select>
            {edited && <span className="snk-embed__edited">edited</span>}
          </span>
        ) : (
          <span className="snk-embed__name" title={name}>
            {name ? baseName(name) : 'Snakie'}
            {edited && <span className="snk-embed__edited">edited</span>}
          </span>
        )}
        {blocksAllowed && params.views && phase.kind === 'ready' && (
          <div className="btn-seg snk-embed__views" role="group" aria-label="View">
            {(['code', 'split', 'blocks'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`btn btn--sm btn--ghost${view === v ? ' is-active' : ''}`}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {v === 'code' ? 'Code' : v === 'split' ? 'Split' : 'Blocks'}
              </button>
            ))}
          </div>
        )}
        <span className="snk-embed__spacer" />
        {runnable && phase.kind === 'ready' && (
          <div className="snk-embed__actions">
            {edited && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={reset} title="Put the original code back">
                <ResetIcon />
                <span>Reset</span>
              </button>
            )}
            {running ? (
              <button type="button" className="btn btn--sm btn--danger" onClick={() => void stop()} title="Stop the program">
                <StopIcon />
                <span>Stop</span>
              </button>
            ) : (
              <button type="button" className="btn btn--sm btn--primary snk-embed__run" onClick={() => void run()} title="Run this program in your browser">
                <PlayIcon />
                <span>Run</span>
              </button>
            )}
          </div>
        )}
      </header>

      <main className="snk-embed__body">
        <div className={`snk-embed__work${boardMode === 'chips' ? ' snk-embed__work--chips' : ''}`}>
        <div className="snk-embed__editor">
          {phase.kind === 'loading' && <div className="snk-embed__message">Loading code…</div>}
          {phase.kind === 'error' && (
            <div className="snk-embed__message snk-embed__message--error" role="alert">
              <p>{phase.message}</p>
              {phase.githubUrl && (
                <a href={phase.githubUrl} target="_blank" rel="noopener noreferrer">
                  See the code on GitHub
                </a>
              )}
            </div>
          )}
          {phase.kind === 'ready' && file && (
            <Suspense
              fallback={
                showCodePane ? (
                  <CodeFallback code={content} title={codeTitle} />
                ) : (
                  <div className="snk-embed__message">Loading blocks…</div>
                )
              }
            >
              {showCodePane ? (
                <PythonPane
                  code={content}
                  onCodeChange={(code) => updateContent(file.id, code)}
                  title={codeTitle}
                  readOnly={!runnable}
                  highlightLines={hoverLines}
                  revealLine={revealLine}
                  onLineFocus={codePins ? setFocusLine : undefined}
                  problems={codePins?.problems}
                />
              ) : (
                <BlocksSplit
                  mode={view === 'code' ? 'python' : view}
                  onModeChange={(m) => setView(m === 'python' ? 'code' : m)}
                />
              )}
            </Suspense>
          )}
        </div>
        {boardMode && codePins && (
          <EmbedBoard
            def={boardDef}
            boards={BUILTIN_BOARDS}
            onBoardChange={setBoardId}
            pins={codePins.pins}
            live={live}
            active={activePins}
            wired={wiredNames}
            onHover={setHoverPin}
            onPick={pickPin}
            mode={boardMode}
          />
        )}
        </div>
        {runnable && phase.kind !== 'error' && (
          <section className={`snk-embed__repl${plots.length > 0 ? ' snk-embed__repl--plots' : ''}`} aria-label="Output">
            {plots.length > 0 && (
              <div className="snk-embed__plots">
                {plots.map((png, i) => (
                  <img key={i} src={`data:image/png;base64,${png}`} alt={`Plot ${i + 1}`} />
                ))}
              </div>
            )}
            <div className="snk-embed__term-wrap">
              <EmbedTerminal
                ref={termRef}
                lineMode={engine.lineMode}
                onInput={onTermInput}
                onInterrupt={() => void stop()}
              />
              {!started && (
                <button type="button" className="snk-embed__term-hint" onClick={() => void run()}>
                  Press <strong>Run</strong> to try this {params.engine === 'pyodide' ? 'Python' : 'MicroPython'} code here.
                </button>
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="snk-embed__footer">
        <span className="snk-embed__engine">
          {runnable ? `Runs ${engine.label} in your browser` : isPython ? engine.label : 'Shown with Snakie'}
        </span>
        <span className="snk-embed__spacer" />
        {githubUrl && (
          <a className="snk-embed__link" href={githubUrl} target="_blank" rel="noopener noreferrer">
            <GitHubIcon />
            <span>View on GitHub</span>
          </a>
        )}
        {snakieUrl && (
          <a
            className="snk-embed__link"
            href={snakieUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={
              params.engine === 'pyodide'
                ? 'Opens in the full Snakie app. Snakie runs MicroPython, so libraries like pandas or matplotlib won’t run there.'
                : edited
                  ? 'Open your edited code in the full Snakie app'
                  : 'Open this code in the full Snakie app'
            }
          >
            <SnakieLogo />
            <span>Open in Snakie</span>
          </a>
        )}
      </footer>
    </div>
  )
}

export default EmbedApp
