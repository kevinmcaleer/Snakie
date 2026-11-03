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
import { GitHubIcon, PlayIcon, ResetIcon, SnakieLogo, StopIcon } from './icons'
import './EmbedApp.css'

const PythonPane = lazy(() => import('../components/PythonPane'))
const BlocksSplit = lazy(() => import('../components/BlocksSplit'))

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

  const file = openFiles.find((f) => f.id === activeId) ?? null
  const content = file?.content ?? ''
  const blocksAllowed = params.engine === 'micropython'

  // Load the program once.
  useEffect(() => {
    let cancelled = false
    loadProgram(params.source, (url) => fetch(url))
      .then((program) => {
        if (cancelled) return
        const code = sliceLines(program.code, params.lines)
        openBuffer(program.name, code)
        if (!params.view && blocksAllowed && hasBlocksFooter(code)) setView('blocks')
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
          image: (png) => setPlots((p) => [...p, png])
        })
        .catch((err: unknown) => {
          bootRef.current = null
          termRef.current?.write(`\r\n\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`)
          throw err
        })
    }
    return bootRef.current
  }, [engine])

  const run = useCallback(async (): Promise<void> => {
    if (running || phase.kind !== 'ready') return
    setRunning(true)
    setPlots([])
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
    if (!params.autorun || !params.run || autoran.current || phase.kind !== 'ready' || !file) return
    autoran.current = true
    void run()
  }, [params.autorun, params.run, phase, file, run])

  const edited = phase.kind === 'ready' && file !== null && content !== phase.original

  // Tell the host how tall we'd like to be.
  useEffect(() => {
    if (params.height !== null) return
    tellHost(params, {
      type: 'height',
      height: preferredHeight({
        lines: phase.kind === 'ready' ? stripBlocksFooter(content).split('\n').length : 6,
        view,
        repl: params.run,
        plots: plots.length > 0,
        error: phase.kind === 'error'
      })
    })
  }, [params, phase.kind, content, view, plots.length])

  const githubUrl =
    phase.kind === 'ready' ? githubUrlFor(phase.program.source, params.lines) : phase.kind === 'error' ? phase.githubUrl : null
  const snakieUrl =
    phase.kind === 'ready'
      ? openInSnakieUrl(APP_ORIGIN, phase.program.source, edited ? content : null, phase.program.name)
      : null
  const name = phase.kind === 'ready' ? phase.program.name : ''

  const onTermInput = useCallback(
    (data: string): void => {
      void boot().then(() => engine.input(data)).catch(() => undefined)
    },
    [boot, engine]
  )

  const codeTitle = params.engine === 'pyodide' ? 'Python' : 'MicroPython'
  const showCodePane = view === 'code' && file !== null && !file.isBlocks

  return (
    <div className={`snk-embed snk-embed--${view}${params.run ? '' : ' snk-embed--viewer'}`}>
      <header className="snk-embed__bar">
        <span className="snk-embed__name" title={name}>
          {name || 'Snakie'}
          {edited && <span className="snk-embed__edited">edited</span>}
        </span>
        {blocksAllowed && phase.kind === 'ready' && (
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
        {params.run && phase.kind === 'ready' && (
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
            <Suspense fallback={<div className="snk-embed__message">Loading editor…</div>}>
              {showCodePane ? (
                <PythonPane
                  code={content}
                  onCodeChange={(code) => updateContent(file.id, code)}
                  title={codeTitle}
                  readOnly={!params.run}
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
        {params.run && phase.kind !== 'error' && (
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
          {params.run ? `Runs ${engine.label} in your browser` : engine.label}
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
