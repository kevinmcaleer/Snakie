/**
 * Main-thread proxy to the MicroPython sim WORKER — epic #267, Phase W1.
 * =============================================================================
 *
 * Presents the same small interface as the earlier in-thread runtime
 * (`init` / `feed` / `runCaptured` / `dispose`) but drives {@link ./mp.worker}
 * over postMessage, so the interpreter runs off the UI thread. Adds `interrupt()`:
 * a plain Ctrl-C when the sim is idle (keeps state), or — when a program is
 * running (possibly a no-yield `while True:`) — terminate + reboot the worker,
 * which is the only way to stop a tight loop without SharedArrayBuffer (absent on
 * GitHub Pages). A reboot resets the sim's RAM filesystem, exactly like a reconnect.
 */
type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void }
type OutMsg =
  | { type: 'out'; bytes: Uint8Array }
  | { type: 'ready' }
  | { type: 'done'; id: number; error?: string }
  | { type: 'result'; id: number; value?: string; error?: string }

export class WorkerMicroPythonRuntime {
  private worker: Worker | null = null
  private onOutput: ((chunk: Uint8Array) => void) | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readyResolve: (() => void) | null = null
  /** In-flight feed/run count — >0 means the interpreter is running. */
  private busy = 0

  async init(onOutput: (chunk: Uint8Array) => void): Promise<void> {
    this.onOutput = onOutput
    await this.spawn()
  }

  private spawn(): Promise<void> {
    this.worker = new Worker(new URL('./mp.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<OutMsg>): void => this.handle(e.data)
    const ready = new Promise<void>((res) => {
      this.readyResolve = res
    })
    this.worker.postMessage({ type: 'init' })
    return ready
  }

  private handle(msg: OutMsg): void {
    if (msg.type === 'out') {
      this.onOutput?.(msg.bytes)
      return
    }
    if (msg.type === 'ready') {
      this.readyResolve?.()
      this.readyResolve = null
      return
    }
    // 'done' (feed) or 'result' (run) — settle the matching request.
    this.busy = Math.max(0, this.busy - 1)
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.type === 'result' ? msg.value : undefined)
  }

  private request<T>(payload: { type: 'feed' | 'run'; data?: string; code?: string }): Promise<T> {
    if (!this.worker) return Promise.reject(new Error('MicroPython worker is not running'))
    const id = this.nextId++
    this.busy++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker!.postMessage({ ...payload, id })
    })
  }

  feed(data: string): Promise<void> {
    return this.request<void>({ type: 'feed', data })
  }

  runCaptured(code: string): Promise<string> {
    return this.request<string>({ type: 'run', code })
  }

  /** Stop whatever's running. Idle → a gentle Ctrl-C (keeps state); running → reboot. */
  async interrupt(): Promise<void> {
    if (this.busy <= 0) {
      await this.feed('\x03').catch(() => undefined)
      return
    }
    await this.reboot()
  }

  private async reboot(): Promise<void> {
    for (const p of this.pending.values()) p.reject(new Error('interrupted'))
    this.pending.clear()
    this.busy = 0
    this.worker?.terminate()
    this.worker = null
    this.onOutput?.(new TextEncoder().encode('\r\n[stopped — simulator restarted]\r\n'))
    await this.spawn()
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.onOutput = null
    this.pending.clear()
    this.busy = 0
  }
}
