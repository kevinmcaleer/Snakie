import { describe, it, expect } from 'vitest'
import { CTRL_A, CTRL_B, CTRL_C, CTRL_D, RawReplEngine, type RawReplTransport } from '../src/shared/raw-repl'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * A minimal fake MicroPython board: replies to the raw-REPL handshake and to
 * `exec`'d code via a caller-supplied `script`, without any real serial port
 * or hardware. This is the whole point of issue #281 (epic #267 Phase W0):
 * the raw-REPL protocol, once extracted from `MicroPythonDevice`, can be unit
 * tested against a fake transport instead of a real board.
 */
class FakeBoard implements RawReplTransport {
  private engine: RawReplEngine | null = null
  private acc = ''
  writes: string[] = []

  /** Wire this fake up to the engine it's driving (for pushing responses back). */
  attach(engine: RawReplEngine): void {
    this.engine = engine
  }

  constructor(private readonly script: (code: string) => { stdout: string; stderr: string }) {}

  async write(data: string | Uint8Array): Promise<void> {
    const str = typeof data === 'string' ? data : decoder.decode(data)
    this.writes.push(str)
    this.acc += str

    if (this.acc.endsWith(CTRL_C + CTRL_C + CTRL_A)) {
      this.acc = ''
      this.reply('raw REPL; CTRL-B to exit\r\n>')
      return
    }
    if (str === CTRL_B) {
      this.acc = ''
      return
    }
    if (str === CTRL_D) {
      const code = this.acc.slice(0, -1)
      this.acc = ''
      const { stdout, stderr } = this.script(code)
      this.reply(`OK${stdout}${CTRL_D}${stderr}${CTRL_D}>`)
      return
    }
  }

  private reply(text: string): void {
    // Simulate the async nature of a real serial link (data arrives later).
    queueMicrotask(() => this.engine?.handleData(encoder.encode(text)))
  }
}

/** Build an engine + fake board pair, wired together, for a given script. */
function makeHarness(
  script: (code: string) => { stdout: string; stderr: string } = () => ({ stdout: '', stderr: '' })
): { engine: RawReplEngine; board: FakeBoard } {
  const board = new FakeBoard(script)
  const engine = new RawReplEngine(board)
  board.attach(engine)
  return { engine, board }
}

describe('RawReplEngine (#281 — transport-agnostic raw-REPL protocol)', () => {
  it('performs the raw-REPL handshake and executes code, capturing stdout', async () => {
    const { engine } = makeHarness((code) => ({ stdout: `ran:${code}\n`, stderr: '' }))
    const result = await engine.exec('print(1+1)')
    expect(result.stdout).toBe('ran:print(1+1)\n')
    expect(result.stderr).toBe('')
  })

  it('captures stderr/tracebacks without throwing from exec()', async () => {
    const { engine } = makeHarness(() => ({ stdout: '', stderr: 'Traceback...\nNameError: x\n' }))
    const result = await engine.exec('x')
    expect(result.stderr).toContain('NameError')
  })

  it('eval() throws when the device produced a non-empty stderr', async () => {
    const { engine } = makeHarness(() => ({ stdout: '', stderr: 'ValueError: boom' }))
    await expect(engine.eval('raise ValueError("boom")')).rejects.toThrow('ValueError: boom')
  })

  it('eval() returns stdout when there is no error', async () => {
    const { engine } = makeHarness(() => ({ stdout: '42\n', stderr: '' }))
    await expect(engine.eval('print(42)')).resolves.toBe('42\n')
  })

  it('serializes concurrent exec calls so they do not interleave on the wire', async () => {
    const seen: string[] = []
    const { engine } = makeHarness((code) => {
      seen.push(code)
      return { stdout: `${code}-out\n`, stderr: '' }
    })
    const [a, b] = await Promise.all([engine.exec('A'), engine.exec('B')])
    expect(seen).toEqual(['A', 'B']) // never interleaved
    expect(a.stdout).toBe('A-out\n')
    expect(b.stdout).toBe('B-out\n')
  })

  it('reuses the same connection to enter+exit raw REPL around each independent exec()', async () => {
    const { engine, board } = makeHarness((code) => ({ stdout: `${code}\n`, stderr: '' }))
    await engine.exec('one')
    await engine.exec('two')
    // Each exec is self-contained: enter raw REPL, run, exit raw REPL — so two
    // sequential execs perform the handshake twice (no protocol regression
    // from the extraction: this matches pre-#281 MicroPythonDevice behaviour).
    const enters = board.writes.filter((w) => w === CTRL_A).length
    expect(enters).toBe(2)
  })

  it('rejects with a timeout when the device never acknowledges exec', async () => {
    const board = new FakeBoard(() => ({ stdout: '', stderr: '' }))
    // Suppress replies to the execution ack ("OK") so the exec-phase readUntil
    // times out (the handshake's readUntil uses a fixed 5s, so we exercise the
    // caller-supplied `timeoutMs` via the post-handshake reads instead).
    const originalReply = (board as unknown as { reply: (t: string) => void }).reply.bind(board)
    ;(board as unknown as { reply: (t: string) => void }).reply = (text: string) => {
      if (text.startsWith('raw REPL')) originalReply(text)
      // else: swallow the "OK..." execution response entirely.
    }
    const engine = new RawReplEngine(board)
    board.attach(engine)
    await expect(engine.exec('print(1)', 50)).rejects.toThrow(/Timed out/)
  })

  it('reset() clears pending state so a stale waiter does not leak into the next connection', async () => {
    const board: RawReplTransport = { write: async () => undefined } // never replies
    const engine = new RawReplEngine(board)
    const pendingExec = engine.exec('print(1)', 5000)
    // Let the handshake's writes/awaits run so `pending` is actually set
    // before we reset — otherwise reset() would race an as-yet-nonexistent
    // waiter.
    await new Promise((resolve) => setTimeout(resolve, 10))
    engine.reset()
    await expect(pendingExec).rejects.toThrow('Disconnected')
  })

  it('execActive is true only while an exec is in flight', async () => {
    const states: boolean[] = []
    const { engine } = makeHarness((code) => {
      states.push(engine.execActive)
      return { stdout: code, stderr: '' }
    })
    expect(engine.execActive).toBe(false)
    await engine.exec('x')
    expect(engine.execActive).toBe(false)
    expect(states).toEqual([true])
  })

  it('round-trips binary content through writeFile/readFileBytes via hex encoding', async () => {
    // Simulate a tiny virtual file so we can exercise the hex chunking path.
    let stored = new Uint8Array(0)
    const { engine } = makeHarness((code) => {
      if (code.includes("open('/x.bin','wb')")) return { stdout: '', stderr: '' }
      const writeMatch = code.match(/_f\.write\(ubinascii\.unhexlify\('([0-9a-f]*)'\)\)/)
      if (writeMatch) {
        const chunk = Uint8Array.from(Buffer.from(writeMatch[1], 'hex'))
        const merged = new Uint8Array(stored.length + chunk.length)
        merged.set(stored, 0)
        merged.set(chunk, stored.length)
        stored = merged
        return { stdout: '', stderr: '' }
      }
      if (code.includes('_f.close()')) return { stdout: '', stderr: '' }
      if (code.includes("open('/x.bin','rb')")) {
        return { stdout: Buffer.from(stored).toString('hex'), stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })
    const payload = new Uint8Array([0, 1, 2, 250, 251, 252, 253])
    await engine.writeFile('/x.bin', payload)
    const readBack = await engine.readFileBytes('/x.bin')
    expect(Array.from(readBack)).toEqual(Array.from(payload))
  })
})
