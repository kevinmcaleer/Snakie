import { useCallback, useEffect, useState } from 'react'
import './VariablesPanel.css'
import { useDeviceStatus } from '../hooks/useDeviceStatus'

/**
 * VARIABLES TAB (issue #16)
 * =========================
 *
 * Inspects the connected board's user globals. When a board is connected we run
 * a small snippet over `window.api.device.exec` that prints one line per global
 * (name, type, repr) in a delimited format, then parse it defensively. When no
 * board is connected we show a hint instead.
 *
 * Hardware can't be exercised in CI, so the snippet is conservative and the
 * parser tolerates partial/garbled output (skips lines it can't read).
 */

interface DeviceVariable {
  name: string
  type: string
  value: string
}

// Field/record separators chosen to be unlikely to appear in a repr. We still
// truncate the repr device-side to keep output bounded, and the parser splits
// on the first two separators only so a repr containing the FS is preserved.
const FS = '␟' // SYMBOL FOR UNIT SEPARATOR
const START = '<<SNAKIE_VARS>>'
const END = '<<SNAKIE_VARS_END>>'

/**
 * Python run on the board. Walks `globals()`, skips dunders and modules, and
 * prints `name FS type FS repr` per entry between sentinel markers. Reprs are
 * truncated so a huge object can't flood the serial link.
 */
const SNIPPET = `
print('${START}')
try:
    for __k in list(globals().keys()):
        if __k.startswith('__'):
            continue
        if __k in ('__k', '__v', '__t', '__r'):
            continue
        __v = globals()[__k]
        __t = type(__v).__name__
        if __t in ('module', 'function', 'builtin_function_or_method'):
            continue
        try:
            __r = repr(__v)
        except Exception:
            __r = '<unreprable>'
        if len(__r) > 200:
            __r = __r[:200] + '...'
        print(__k + '${FS}' + __t + '${FS}' + __r)
except Exception as __e:
    print('ERR' + '${FS}' + 'error' + '${FS}' + repr(__e))
print('${END}')
`.trim()

/** Parse the snippet's stdout into variable records (defensive). */
export function parseVariables(stdout: string): DeviceVariable[] {
  const vars: DeviceVariable[] = []
  if (!stdout) return vars
  const lines = stdout.split(/\r?\n/)
  let inBlock = false
  for (const line of lines) {
    if (line.includes(START)) {
      inBlock = true
      continue
    }
    if (line.includes(END)) break
    if (!inBlock) continue
    const first = line.indexOf(FS)
    if (first === -1) continue
    const second = line.indexOf(FS, first + 1)
    if (second === -1) continue
    const name = line.slice(0, first)
    const type = line.slice(first + 1, second)
    const value = line.slice(second + 1)
    if (name.length === 0) continue
    vars.push({ name, type, value })
  }
  return vars
}

export function VariablesPanel(): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'

  const [vars, setVars] = useState<DeviceVariable[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.device.exec(SNIPPET)
      if (result.stderr && result.stderr.trim().length > 0) {
        setError(result.stderr.trim())
      }
      setVars(parseVariables(result.stdout ?? ''))
      setLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setVars([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-load once when a connection first appears; clear when it drops.
  useEffect(() => {
    if (connected && !loaded && !loading) {
      void refresh()
    }
    if (!connected) {
      setVars([])
      setLoaded(false)
      setError(null)
    }
  }, [connected, loaded, loading, refresh])

  if (!connected) {
    return (
      <div className="vars">
        <p className="vars__hint">
          Connect a board to inspect its variables. Once connected, the
          device&apos;s global variables will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="vars">
      <div className="vars__toolbar">
        <span className="vars__count">
          {loading ? 'Reading…' : `${vars.length} variable${vars.length === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          className="vars__refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error != null && <p className="vars__error">{error}</p>}

      {!loading && vars.length === 0 && error == null && (
        <p className="vars__hint">
          No user variables defined yet. Run some code, then Refresh.
        </p>
      )}

      <ul className="vars__list" role="list">
        {vars.map((v) => (
          <li key={v.name} className="vars__item">
            <span className="vars__name">{v.name}</span>
            <span className="vars__type">{v.type}</span>
            <span className="vars__value" title={v.value}>
              {v.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
