import { describe, it, expect, vi } from 'vitest'
import {
  RawReplClient,
  pyStr,
  RAW_REPL_NO_RESPONSE,
  type SerialTransport
} from '../src/shared/raw-repl'
import { RUNTIME_PROBE_PY, parseRuntimeProbe, runtimeGreeting } from '../src/shared/dialect'

/**
 * The transport-agnostic raw-REPL client (#465) against a MOCK board — proves the
 * protocol handshake, exec output framing, and the filesystem helpers work with
 * no hardware. The mock speaks the real raw-REPL byte protocol back.
 */
const enc = new TextEncoder()
const dec = new TextDecoder()

/** A fake MicroPython board that answers the raw-REPL handshake over a transport. */
class MockBoard implements SerialTransport {
  private cb: ((c: Uint8Array) => void) | null = null
  private buf = ''
  private raw = false
  /** stdout the next exec should return (default: empty). */
  nextStdout = ''
  /** How many blocks the board has been asked to execute (Ctrl-D in raw mode). */
  execCount = 0
  nextStderr = ''
  /** Deliver the Ctrl-B banner asynchronously (like real serial latency) rather
   *  than synchronously inside write() — proves the suppression handles timing. */
  asyncBanner = false
  /** A wedged/absent board: never answers the raw-REPL handshake (#712). */
  silent = false
  closed = false

  onData(cb: (c: Uint8Array) => void): void {
    this.cb = cb
  }
  private emit(s: string): void {
    this.cb?.(enc.encode(s))
  }
  async write(data: Uint8Array): Promise<void> {
    const s = dec.decode(data)
    for (const ch of s) {
      if (ch === '\x01') {
        // Ctrl-A → enter raw REPL, reply with the banner (unless wedged/absent).
        if (this.silent) continue
        this.raw = true
        this.buf = ''
        this.emit('\r\nraw REPL; CTRL-B to exit\r\n>')
      } else if (ch === '\x02') {
        // Ctrl-B → back to the friendly REPL, which REPRINTS its banner + prompt
        // (this is the #612 "looks like a reboot" source we must suppress).
        this.raw = false
        const banner = '\r\nMicroPython v9.9.9 on 2026; MockBoard with RP2\r\nType "help()" for more information.\r\n>>> '
        if (this.asyncBanner) setTimeout(() => this.emit(banner), 5)
        else this.emit(banner)
      } else if (ch === '\x04' && this.raw) {
        // Ctrl-D in raw mode → execute the buffered code, frame the response.
        this.execCount++
        this.buf = ''
        this.emit('OK' + this.nextStdout + '\x04' + this.nextStderr + '\x04>')
      } else if (ch !== '\x03') {
        this.buf += ch
      }
    }
  }
  async close(): Promise<void> {
    this.closed = true
  }
}

const setup = (): { board: MockBoard; client: RawReplClient; console: string } => {
  const board = new MockBoard()
  const state = { console: '' }
  const client = new RawReplClient(board, (c) => (state.console += dec.decode(c)))
  return { board, client, get console() { return state.console } } as never
}

describe('RawReplClient', () => {
  it('pyStr escapes for a MicroPython string literal', () => {
    expect(pyStr('/lib/x.py')).toBe("'/lib/x.py'")
    expect(pyStr("a'b\\c")).toBe("'a\\'b\\\\c'")
  })

  it('surfaces an actionable error when the board never answers the handshake (#712)', async () => {
    vi.useFakeTimers()
    try {
      const board = new MockBoard()
      board.silent = true // a wedged / firmware-less board that ignores Ctrl-A
      const client = new RawReplClient(board, () => undefined)
      const result = client.exec('print(1)').catch((e: Error) => e)
      await vi.advanceTimersByTimeAsync(5000) // let the idle window elapse
      const err = await result
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toBe(RAW_REPL_NO_RESPONSE)
      expect((err as Error).message).toMatch(/didn't respond/) // not the opaque low-level text
    } finally {
      vi.useRealTimers()
    }
  })

  it('exec captures stdout + stderr through the raw-REPL frame', async () => {
    const { board, client } = setup()
    board.nextStdout = 'hello\n'
    board.nextStderr = ''
    const r = await client.exec('print("hello")')
    expect(r.stdout).toBe('hello\n')
    expect(r.stderr).toBe('')
  })

  it('eval throws on a traceback (stderr)', async () => {
    const { board, client } = setup()
    board.nextStdout = ''
    board.nextStderr = 'Traceback: NameError'
    await expect(client.eval('boom')).rejects.toThrow(/NameError/)
  })

  it('listDir parses the ilistdir JSON snippet', async () => {
    const { board, client } = setup()
    board.nextStdout = JSON.stringify([['main.py', false, 42], ['lib', true, 0]]) + '\n'
    const entries = await client.listDir('/')
    expect(entries).toEqual([
      { name: 'main.py', isDir: false, size: 42 },
      { name: 'lib', isDir: true, size: 0 }
    ])
  })

  it('readFileBytes decodes the hex the board prints', async () => {
    const { board, client } = setup()
    board.nextStdout = '68656c6c6f' // "hello"
    expect(dec.decode(await client.readFileBytes('/x'))).toBe('hello')
  })

  it('does not leak exec/handshake bytes to the console', async () => {
    const board = new MockBoard()
    let consoleOut = ''
    const client = new RawReplClient(board, (c) => (consoleOut += dec.decode(c)))
    board.nextStdout = 'x'
    await client.exec('1')
    // The raw-REPL banner + OK/framing must NOT reach the user console.
    expect(consoleOut).not.toContain('raw REPL')
    expect(consoleOut).not.toContain('OK')
    // But a normal sendData passthrough does reach the board (and echoes).
    await client.sendData('print(1)\r')
    expect(board).toBeTruthy()
  })

  it('serialises concurrent exec calls (opQueue)', async () => {
    const { board, client } = setup()
    board.nextStdout = 'a'
    const [a, b] = await Promise.all([client.exec('1'), client.exec('2')])
    expect(a.stdout).toBe('a')
    expect(b.stdout).toBe('a')
  })

  it('runProgram streams ONLY the program output — no source echo, no === / framing (#612)', async () => {
    const s = setup() as unknown as { board: MockBoard; client: RawReplClient; console: string }
    s.board.nextStdout = 'hello\nworld\n'
    s.board.nextStderr = ''
    await s.client.runProgram('print("hello")\nprint("world")')
    // The program's own stdout reached the console, then a clean `>>>` prompt…
    expect(s.console).toBe('hello\nworld\n\r\n>>> ')
    // …and NONE of the raw-REPL framing or the source did (the #612 bug).
    expect(s.console).not.toContain('OK')
    expect(s.console).not.toContain('raw REPL')
    expect(s.console).not.toContain('print(') // no source echo
    expect(s.console).not.toContain('===') // no paste-mode banner/prefixes
    expect(s.console).not.toContain('\x04')
    // The friendly-REPL banner that Ctrl-B reprints must NOT leak (looks like a
    // reboot after every run) — only the single clean prompt we add.
    expect(s.console).not.toContain('MicroPython v')
    expect(s.console).not.toContain('help()')
  })

  it('suppresses the reprinted banner even when it arrives ASYNC after Ctrl-B (#612)', async () => {
    const s = setup() as unknown as { board: MockBoard; client: RawReplClient; console: string }
    s.board.asyncBanner = true // real serial latency: banner lands after write() resolves
    s.board.nextStdout = 'ran\n'
    await s.client.runProgram('print("ran")')
    // Give the delayed banner time to arrive; it must NOT have leaked.
    await new Promise((r) => setTimeout(r, 20))
    expect(s.console).toContain('ran\n')
    expect(s.console).not.toContain('MicroPython v')
    expect(s.console).not.toContain('help()')
  })

  it('runProgram streams a traceback (stderr) to the console, still no echo (#612)', async () => {
    const s = setup() as unknown as { board: MockBoard; client: RawReplClient; console: string }
    s.board.nextStdout = ''
    s.board.nextStderr = 'Traceback (most recent call last):\n  NameError: boom\n'
    await s.client.runProgram('boom')
    expect(s.console).toContain('NameError: boom')
    expect(s.console).not.toContain('boom\n===') // not the echoed source
    expect(s.console).not.toContain('OK')
    expect(s.console).not.toContain('\x04')
  })
})

/**
 * The CONNECT PROBE (#752, epic #209) end to end: the Python we actually send,
 * over the real raw-REPL framing, through the parser, back out as the greeting
 * the terminal prints. Both desktop and web run this same chain, so a sentinel
 * changed on one side of it and not the other fails here.
 */
describe('runtime probe over the raw REPL', () => {
  const probeReply = (name: string, version: string, machine: string): string =>
    `SNKIMPL ${name}\nSNKVER ${version}\nSNKMACH ${machine}\n`

  it('identifies a MicroPython board and rebuilds its own banner', async () => {
    const { board, client } = setup()
    board.nextStdout = probeReply('micropython', '1.28.0 on 2026-01-01', 'Raspberry Pi Pico with RP2040')
    const info = parseRuntimeProbe(await client.eval(RUNTIME_PROBE_PY))
    expect(info?.dialect).toBe('micropython')
    expect(runtimeGreeting(info)).toBe('MicroPython v1.28.0 on 2026-01-01; Raspberry Pi Pico with RP2040')
  })

  it('identifies a CircuitPython board and greets it in ITS wording, not MicroPython\'s', async () => {
    const { board, client } = setup()
    board.nextStdout = probeReply(
      'circuitpython',
      '10.2.1 on 2026-08-18',
      'Adafruit Feather RP2040 with rp2040'
    )
    const info = parseRuntimeProbe(await client.eval(RUNTIME_PROBE_PY))
    expect(info?.dialect).toBe('circuitpython')
    const greeting = runtimeGreeting(info)
    expect(greeting).toBe('Adafruit CircuitPython 10.2.1 on 2026-08-18; Adafruit Feather RP2040 with rp2040')
    expect(greeting).not.toContain('MicroPython')
  })

  it('leaves a board that answers nothing unidentified, rather than assuming MicroPython', async () => {
    const { board, client } = setup()
    board.nextStdout = ''
    const info = parseRuntimeProbe(await client.eval(RUNTIME_PROBE_PY))
    expect(info).toBeNull()
    expect(runtimeGreeting(info)).toBe('')
  })

  it('sends the probe as ONE exec — the connect path must not cost several round trips', async () => {
    const { board, client } = setup()
    board.nextStdout = probeReply('micropython', '1.28.0', 'Board')
    const before = board.execCount
    await client.eval(RUNTIME_PROBE_PY)
    expect(board.execCount - before).toBe(1)
  })
})
