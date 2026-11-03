/**
 * A PRIVATE localStorage FOR THE EMBED (#1286).
 * =============================================================================
 *
 * The embed is served from the app's own origin (app.snakie.org/embed.html),
 * so it would share the app's localStorage — and the stores it reuses write
 * there: the session restore would reopen (and then overwrite) the learner's
 * open files, the layout store would save the embed's pane sizes as theirs.
 * Inside a third-party iframe the browser may also refuse storage outright,
 * and some stores read it during render.
 *
 * So before anything else loads, `window.localStorage` is swapped for an
 * in-memory one, seeded with the embed's own preferences. Nothing an embed does
 * survives the page or touches the app.
 */
export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>()

  constructor(seed: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(seed)) this.map.set(k, v)
  }

  get length(): number {
    return this.map.size
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}

export function installMemoryStorage(seed: Record<string, string>): void {
  const storage = new MemoryStorage(seed)
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => storage })
}
