import { describe, it, expect } from 'vitest'
import { RawReplClient, pyStr, type SerialTransport } from '../src/shared/raw-repl'

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
  nextStderr = ''
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
        // Ctrl-A → enter raw REPL, reply with the banner.
        this.raw = true
        this.buf = ''
        this.emit('\r\nraw REPL; CTRL-B to exit\r\n>')
      } else if (ch === '\x02') {
        this.raw = false
      } else if (ch === '\x04' && this.raw) {
        // Ctrl-D in raw mode → execute the buffered code, frame the response.
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
    // The program's own stdout reached the console…
    expect(s.console).toBe('hello\nworld\n')
    // …and NONE of the raw-REPL framing or the source did (the #612 bug).
    expect(s.console).not.toContain('OK')
    expect(s.console).not.toContain('raw REPL')
    expect(s.console).not.toContain('print(') // no source echo
    expect(s.console).not.toContain('===') // no paste-mode banner/prefixes
    expect(s.console).not.toContain('\x04')
    expect(s.console).not.toContain('>')
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
