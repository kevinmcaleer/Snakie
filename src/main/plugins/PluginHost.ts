import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type {
  CommandInfo,
  PluginContext,
  PluginInfo,
  PluginListing,
  PluginStatus,
  RunCommandResult
} from './types'

/**
 * PluginHost — spawns and supervises the Python plugin host
 * (`python3 -m snakie.host`) and exchanges newline-delimited JSON-RPC over its
 * stdio (issue #61).
 *
 * Design:
 * - Locates a Python interpreter (`python3` then `python` on PATH for the MVP;
 *   a configurable setting is a follow-up). If none works the host enters a
 *   "no Python" state ({@link status} reports `pythonFound:false`) — the rest
 *   of the app is unaffected and the Plugins panel shows a friendly install
 *   prompt.
 * - Runs the host with the bundled `python/` package on `PYTHONPATH` and the
 *   bundled `examples/plugins` dir passed via `SNAKIE_PLUGIN_DIRS`, so the
 *   feature demos out of the box. The host additionally scans
 *   `~/.snakie/plugins/` for the user's own plugins.
 * - Requests are correlated by a monotonically-increasing id. The host is
 *   spawned lazily on first use; {@link reload} kills and re-spawns it (picking
 *   up newly added plugins). {@link dispose} is called on app quit.
 *
 * Failures never crash the app: a spawn error, a host that exits, or a malformed
 * line all reject the in-flight requests and flip the status flag.
 */
export class PluginHost {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >()

  private pythonCmd: string | null = null
  private startError: string | null = null
  private starting: Promise<void> | null = null

  /**
   * The interpreter candidates to try, in order. `python3` is preferred; on
   * Windows `python` is the common name. A configurable override is a follow-up.
   */
  private static readonly INTERPRETERS = ['python3', 'python']

  /** Resolve the bundled `python/` dir (contains the `snakie` package). */
  private pythonPackageDir(): string {
    // Packaged: shipped under resources via electron-builder `extraResources`.
    // Dev: __dirname is `out/main`, so the repo root is two levels up.
    const packaged = join(process.resourcesPath, 'python')
    if (app.isPackaged && existsSync(packaged)) return packaged
    return join(__dirname, '..', '..', 'python')
  }

  /** Resolve the bundled `examples/plugins` dir. */
  private bundledPluginsDir(): string {
    const packaged = join(process.resourcesPath, 'examples', 'plugins')
    if (app.isPackaged && existsSync(packaged)) return packaged
    return join(__dirname, '..', '..', 'examples', 'plugins')
  }

  /**
   * Try each interpreter candidate until one spawns the host successfully.
   * Resolves once a live child is connected; sets {@link startError} and leaves
   * {@link child} null if none work.
   */
  private async start(): Promise<void> {
    if (this.child) return
    if (this.starting) return this.starting
    this.starting = this.doStart().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async doStart(): Promise<void> {
    this.startError = null
    const pkgDir = this.pythonPackageDir()
    const pluginsDir = this.bundledPluginsDir()
    const errors: string[] = []

    for (const cmd of PluginHost.INTERPRETERS) {
      try {
        const child = spawn(cmd, ['-u', '-m', 'snakie.host'], {
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONPATH: [pkgDir, process.env.PYTHONPATH].filter(Boolean).join(
              process.platform === 'win32' ? ';' : ':'
            ),
            SNAKIE_PLUGIN_DIRS: pluginsDir
          }
        })

        // Surface a spawn failure (e.g. interpreter not on PATH) synchronously
        // enough to try the next candidate.
        const spawned = await new Promise<boolean>((resolve) => {
          let settled = false
          child.once('spawn', () => {
            if (!settled) {
              settled = true
              resolve(true)
            }
          })
          child.once('error', (err) => {
            if (!settled) {
              settled = true
              errors.push(`${cmd}: ${err.message}`)
              resolve(false)
            }
          })
        })

        if (!spawned) continue

        this.attach(child)
        // Verify the host actually answers (catches a present interpreter that
        // can't import the SDK, e.g. a broken PYTHONPATH).
        await this.request('initialize')
        this.pythonCmd = cmd
        return
      } catch (err) {
        errors.push(`${cmd}: ${err instanceof Error ? err.message : String(err)}`)
        this.teardownChild()
      }
    }

    this.startError =
      errors.length > 0
        ? `No working Python interpreter found (${errors.join('; ')})`
        : 'No Python interpreter found on PATH'
  }

  /** Wire up stdout parsing + lifecycle handlers for a spawned child. */
  private attach(child: ChildProcessWithoutNullStreams): void {
    this.child = child
    this.buffer = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onData(chunk))

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // Host diagnostics + plugin stdout (redirected to stderr by the host).
      console.error('[snakie.host]', chunk.toString().trimEnd())
    })

    const onExit = (code: number | null): void => {
      const err = new Error(`Python plugin host exited (code ${code ?? 'null'})`)
      this.failPending(err)
      if (this.child === child) {
        this.child = null
        // Only record as a fatal status if it died after starting cleanly.
        if (this.pythonCmd) this.startError = err.message
      }
    }
    child.once('exit', onExit)
    child.once('error', (err) => {
      this.failPending(err)
    })
  }

  /** Accumulate stdout and dispatch each complete JSON line. */
  private onData(chunk: string): void {
    this.buffer += chunk
    let idx = this.buffer.indexOf('\n')
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line) this.dispatchLine(line)
      idx = this.buffer.indexOf('\n')
    }
  }

  private dispatchLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string } }
    try {
      msg = JSON.parse(line)
    } catch {
      console.error('[snakie.host] unparseable line:', line)
      return
    }
    if (typeof msg.id !== 'number') return // notification (unused in MVP)
    const entry = this.pending.get(msg.id)
    if (!entry) return
    this.pending.delete(msg.id)
    if (msg.error) {
      entry.reject(new Error(msg.error.message ?? 'plugin host error'))
    } else {
      entry.resolve(msg.result)
    }
  }

  /** Reject all in-flight requests (host died / errored). */
  private failPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err)
    this.pending.clear()
  }

  /** Send a JSON-RPC request and await its correlated response. */
  private request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const child = this.child
    if (!child) return Promise.reject(new Error('plugin host not running'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject
      })
      const payload = JSON.stringify({ id, method, params: params ?? {} }) + '\n'
      child.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  private teardownChild(): void {
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        // ignore
      }
      this.child = null
    }
  }

  // --- Public API ----------------------------------------------------------

  /** Whether a Python host is available (spawns lazily to find out). */
  async status(): Promise<PluginStatus> {
    await this.start()
    if (this.child && this.pythonCmd) {
      return { pythonFound: true, python: this.pythonCmd }
    }
    return {
      pythonFound: false,
      error: this.startError ?? 'Python interpreter not found'
    }
  }

  /** Discovered plugins + their registered commands. */
  async list(): Promise<PluginListing> {
    await this.start()
    if (!this.child) {
      // No Python: an empty listing (the panel uses status() for the prompt).
      return { plugins: [], commands: [] }
    }
    const init = await this.request<{ plugins: PluginInfo[] }>('initialize')
    const cmds = await this.request<{ commands: CommandInfo[] }>('listCommands')
    return { plugins: init.plugins ?? [], commands: cmds.commands ?? [] }
  }

  /** Run a command against the given editor context, returning its actions. */
  async runCommand(commandId: string, context: PluginContext): Promise<RunCommandResult> {
    await this.start()
    if (!this.child) {
      throw new Error(this.startError ?? 'Python plugin host is not available')
    }
    return this.request<RunCommandResult>('runCommand', { commandId, context })
  }

  /** Kill and re-spawn the host (picks up newly added plugins). */
  async reload(): Promise<PluginStatus> {
    await this.dispose()
    this.pythonCmd = null
    this.startError = null
    return this.status()
  }

  /** Gracefully shut down the host (best-effort). Called on app quit. */
  async dispose(): Promise<void> {
    const child = this.child
    if (!child) return
    try {
      // Ask politely; ignore failures, then ensure it's gone.
      await Promise.race([
        this.request('shutdown').catch(() => undefined),
        new Promise((r) => setTimeout(r, 500))
      ])
    } finally {
      this.failPending(new Error('plugin host disposed'))
      this.teardownChild()
      this.pythonCmd = null
    }
  }
}
