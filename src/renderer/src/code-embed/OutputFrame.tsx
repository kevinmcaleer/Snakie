import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { stripBlocksFooter } from '../../../shared/blocks-doc'
import { BUILTIN_BOARDS, DEFAULT_BOARD_ID } from '../components/board-defs'
import type { EmbedParams } from './params'
import { loadProgram, openInSnakieUrl, type LoadedProgram } from './source'
import { createEngine, type EmbedEngine } from './engines'
import { EmbedTerminal, type EmbedTerminalHandle } from './EmbedTerminal'
import { EmbedBoard, type PinLive } from './EmbedBoard'
import { pinsInCode, resolvePin, type PinEvent } from './embed-pins'
import { PlayIcon, SnakieLogo, StopIcon } from './icons'
import { outputHeight } from './layout'
// The board strip's styles live with the code frame's.
import './EmbedApp.css'
import './OutputFrame.css'

/**
 * THE LESSON RUNNER'S OUTPUT PANEL — `embed.html?output=1`.
 * =============================================================================
 *
 * A page keeps its own plain code block (so a lesson still reads like a
 * lesson) and, when the reader presses play, `SnakieEmbed.runner()` pops this
 * up under it: a slim run bar, the program's output in a live REPL, and, when
 * the code uses pins, the board with each pin lit as the simulator drives it.
 * No editor, no blocks: Monaco and Blockly never load, so the panel is quick.
 *
 * The host's play button and this panel stay in step by postMessage:
 *   host → frame  { source: 'snakie-embed-host', type: 'run' | 'stop' }
 *   frame → host  { type: 'run-state', running } and { type: 'close' }
 * (plus `height`, as every embed sends).
 */

/** Narrower than this, the board would squeeze the output: the pins become a row of chips. */
const BOARD_SIDE_MIN_W = 600

function tellHost(params: EmbedParams, message: Record<string, unknown>): void {
  if (window.parent === window) return
  window.parent.postMessage({ source: 'snakie-embed', id: params.id, ...message }, '*')
}

function boardFor(id: string | null): string {
  if (!id) return DEFAULT_BOARD_ID
  const want = id.toLowerCase().replace(/[^a-z0-9]/g, '')
  const hit = BUILTIN_BOARDS.find(
    (b) => b.id.toLowerCase().replace(/[^a-z0-9]/g, '') === want || b.name.toLowerCase().replace(/[^a-z0-9]/g, '') === want
  )
  return hit?.id ?? DEFAULT_BOARD_ID
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

type Status = 'loading' | 'starting' | 'running' | 'done' | 'stopped' | 'error'

const STATUS_TEXT: Record<Exclude<Status, 'starting'>, string> = {
  loading: 'Getting ready…',
  running: 'Running',
  done: 'Finished. Type below to try more.',
  stopped: 'Stopped',
  error: 'Couldn’t run'
}

export function OutputFrame({ params }: { params: EmbedParams }): JSX.Element {
  const [program, setProgram] = useState<LoadedProgram | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [plots, setPlots] = useState<string[]>([])
  const [boardId, setBoardId] = useState(() => boardFor(params.board))
  const [live, setLive] = useState<ReadonlyMap<string, PinLive>>(() => new Map())
  const [hoverPin, setHoverPin] = useState<string | null>(null)
  const engine = useMemo<EmbedEngine>(() => createEngine(params.engine, params.packages), [params])
  const termRef = useRef<EmbedTerminalHandle>(null)
  const bootRef = useRef<Promise<void> | null>(null)
  const runningRef = useRef(false)
  /** Quiet until the program starts: the reader asked for its output, not MicroPython's banner. */
  const quietRef = useRef(true)
  const width = useWindowWidth()
  const boardDef = BUILTIN_BOARDS.find((b) => b.id === boardId) ?? BUILTIN_BOARDS[0]
  const boardRef = useRef(boardDef)
  boardRef.current = boardDef

  // Pin changes come far faster than a screen draws: keep the latest of each, paint once a frame.
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
    })
  }, [])
  useEffect(() => () => cancelAnimationFrame(liveFrame.current), [])
  useEffect(() => () => engine.dispose(), [engine])

  useEffect(() => {
    let cancelled = false
    loadProgram(params.source, (url) => fetch(url))
      .then((p) => {
        if (cancelled) return
        setProgram({ ...p, code: stripBlocksFooter(p.code) })
        document.title = `${p.name} · output · Snakie`
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStatus('error')
        setMessage(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [params.source])

  const codePins = useMemo(
    () => (params.pins && program ? pinsInCode(program.code, boardDef) : null),
    [params.pins, program, boardDef]
  )
  const hasPins = !!codePins && codePins.pins.length > 0
  const boardMode: 'side' | 'chips' | null = !hasPins ? null : width >= BOARD_SIDE_MIN_W ? 'side' : 'chips'

  const boot = useCallback((): Promise<void> => {
    if (!bootRef.current) {
      bootRef.current = engine
        .start({
          output: (text) => {
            if (!quietRef.current) termRef.current?.write(text)
          },
          image: (png) => setPlots((p) => [...p, png]),
          ...(params.pins ? { pin: onPinEvent } : {})
        })
        .catch((err: unknown) => {
          bootRef.current = null
          throw err
        })
    }
    return bootRef.current
  }, [engine, params.pins, onPinEvent])

  const run = useCallback(async (): Promise<void> => {
    if (!program || runningRef.current) return
    runningRef.current = true
    setStatus(bootRef.current ? 'running' : 'starting')
    setMessage(null)
    setPlots([])
    liveQueue.current.clear()
    setLive(new Map())
    tellHost(params, { type: 'run-state', running: true })
    let failed = false
    try {
      await boot()
      // A fresh screen for each run, as on a board after a reset. Written, not
      // term.clear(): xterm draws writes later, so a clear() would land first.
      termRef.current?.write('\x1b[2J\x1b[3J\x1b[H')
      quietRef.current = false
      setStatus('running')
      await engine.run(program.code)
    } catch (err) {
      failed = true
      setStatus('error')
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      const wasRunning = runningRef.current
      runningRef.current = false
      if (!failed && wasRunning) setStatus('done')
      tellHost(params, { type: 'run-state', running: false })
    }
  }, [program, boot, engine, params])

  const stop = useCallback(async (): Promise<void> => {
    if (!runningRef.current) return
    runningRef.current = false
    setStatus('stopped')
    // Stopping may restart the interpreter: its fresh banner isn't news.
    quietRef.current = true
    await engine.stop()
    quietRef.current = false
    termRef.current?.write(`\r\n\x1b[2m(stopped)\x1b[0m\r\n${engine.lineMode ? '' : '>>> '}`)
    tellHost(params, { type: 'run-state', running: false })
  }, [engine, params])

  // Run as soon as the code is here (the reader pressed play to get this panel).
  const autoran = useRef(false)
  useEffect(() => {
    if (!program || autoran.current || !params.autorun) return
    autoran.current = true
    void run()
  }, [program, params.autorun, run])

  // The host's play button: run again, or stop.
  const runRef = useRef(run)
  runRef.current = run
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== window.parent || window.parent === window) return
      const data = e.data as { source?: unknown; type?: unknown } | null
      if (!data || data.source !== 'snakie-embed-host') return
      if (data.type === 'run') void runRef.current()
      else if (data.type === 'stop') void stopRef.current()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Say how tall we'd like to be: the host sizes the frame to it.
  useEffect(() => {
    if (params.height !== null) return
    tellHost(params, { type: 'height', height: outputHeight({ board: boardMode, plots: plots.length > 0, message: status === 'error' }) })
  }, [params, boardMode, plots.length, status])

  const onTermInput = useCallback(
    (data: string): void => {
      void boot()
        .then(() => engine.input(data))
        .catch(() => undefined)
    },
    [boot, engine]
  )

  const running = status === 'running' || status === 'starting'
  const snakieUrl = program ? openInSnakieUrl(window.location.origin, program.source, program.code, program.name, false) : null

  return (
    <div className={`snk-out${boardMode === 'side' ? ' snk-out--side' : ''}`}>
      <header className="snk-out__bar">
        <span className={`snk-out__dot snk-out__dot--${status}`} aria-hidden="true" />
        <span className="snk-out__title">Output</span>
        <span className="snk-out__status" role="status" aria-live="polite">
          {status === 'starting' ? `Starting ${engine.label}…` : STATUS_TEXT[status]}
        </span>
        <span className="snk-out__spacer" />
        {running ? (
          <button type="button" className="snk-out__btn snk-out__btn--stop" onClick={() => void stop()} title="Stop the program">
            <StopIcon />
            <span>Stop</span>
          </button>
        ) : (
          <button
            type="button"
            className="snk-out__btn snk-out__btn--run"
            onClick={() => void run()}
            title="Run the code again"
          >
            <PlayIcon />
            <span>Run again</span>
          </button>
        )}
        <button
          type="button"
          className="snk-out__close"
          onClick={() => {
            void stop()
            tellHost(params, { type: 'close' })
          }}
          title="Close the output"
          aria-label="Close the output"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {status === 'error' && message && (
        <div className="snk-out__message" role="alert">
          <span>{message}</span>
          {snakieUrl && (
            <a href={snakieUrl} target="_blank" rel="noopener noreferrer">
              <SnakieLogo />
              <span>Open it in Snakie instead</span>
            </a>
          )}
        </div>
      )}
      <div className="snk-out__body">
        <div className="snk-out__main">
          {plots.length > 0 && (
            <div className="snk-out__plots">
              {plots.map((png, i) => (
                <img key={i} src={`data:image/png;base64,${png}`} alt={`Plot ${i + 1}`} />
              ))}
            </div>
          )}
          <div className="snk-out__term">
            <EmbedTerminal ref={termRef} lineMode={engine.lineMode} onInput={onTermInput} onInterrupt={() => void stop()} />
          </div>
          {boardMode === 'chips' && codePins && (
            <EmbedBoard
              def={boardDef}
              boards={BUILTIN_BOARDS}
              onBoardChange={setBoardId}
              pins={codePins.pins}
              live={live}
              active={new Set(hoverPin ? [hoverPin] : [])}
              onHover={setHoverPin}
              onPick={setHoverPin}
              mode="chips"
            />
          )}
        </div>
        {boardMode === 'side' && codePins && (
          <EmbedBoard
            def={boardDef}
            boards={BUILTIN_BOARDS}
            onBoardChange={setBoardId}
            pins={codePins.pins}
            live={live}
            active={new Set(hoverPin ? [hoverPin] : [])}
            onHover={setHoverPin}
            onPick={setHoverPin}
            mode="side"
          />
        )}
      </div>
    </div>
  )
}

export default OutputFrame
