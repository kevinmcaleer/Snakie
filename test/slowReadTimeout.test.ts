import { describe, it, expect, vi, afterEach } from 'vitest'
import { RawReplClient, type SerialTransport } from '../src/shared/raw-repl'

/**
 * A LARGE read must not be killed for being large (#700).
 * =============================================================================
 *
 * The version check read the whole of `instruments.py` back off the board to keep
 * one line. Reading hex-encodes, so 80,835 bytes became 161,670 on the wire — 14 s
 * at 115200 baud, against a 10 s total timeout. It could never finish. Worse, the
 * abort left the board mid-dump, and with the exec over, its console suppression
 * ended too: the undelivered remainder landed in the user's terminal as raw hex.
 *
 * The timeout is now an IDLE window. A device that is answering keeps its read
 * alive however long the answer is; a device that has gone quiet still fails
 * promptly. These use fake timers so a 14-second transfer costs no wall clock.
 */
const enc = new TextEncoder()
const dec = new TextDecoder()

/**
 * A board that answers a read in DRIBS, the way a real serial link does — a chunk
 * every `gapMs`, so the transfer takes as long as its size demands.
 */
class DribblingBoard implements SerialTransport {
  private cb: ((c: Uint8Array) => void) | null = null
  /** stdout to deliver, split across chunks. */
  payload = ''
  /** ms between chunks — the wire's pace. */
  gapMs = 100
  /** bytes per chunk. */
  chunk = 64
  /** Stop dribbling after this many chunks, to simulate a board going silent. */
  stopAfter = Infinity
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
      if (ch === '\x01') this.emit('\r\nraw REPL; CTRL-B to exit\r\n>')
      else if (ch === '\x02') this.emit('\r\n>>> ')
      else if (ch === '\x04') this.dribble()
    }
  }
  /** Deliver `OK<payload>\x04\x04>` a chunk at a time, paced by `gapMs`. */
  private dribble(): void {
    const frame = 'OK' + this.payload + '\x04' + '\x04>'
    const parts: string[] = []
    for (let i = 0; i < frame.length; i += this.chunk) parts.push(frame.slice(i, i + this.chunk))
    parts.slice(0, this.stopAfter).forEach((part, i) => {
      setTimeout(() => this.emit(part), (i + 1) * this.gapMs)
    })
  }
  async close(): Promise<void> {
    this.closed = true
  }
}

afterEach(() => vi.useRealTimers())

describe('a slow read is not killed for being slow (#700)', () => {
  it('survives a transfer far longer than the timeout, while bytes keep arriving', async () => {
    vi.useFakeTimers()
    const board = new DribblingBoard()
    let consoleOut = ''
    const client = new RawReplClient(board, (c) => (consoleOut += dec.decode(c)))

    // 161,670 hex chars at 64 bytes per 100 ms ≈ 253 s — 25× the 10 s timeout, and
    // the same shape as the real failure.
    board.payload = 'ab'.repeat(80_835)
    board.gapMs = 100
    board.chunk = 64

    const pending = client.exec('read the library')
    await vi.advanceTimersByTimeAsync(300_000)
    const r = await pending

    expect(r.stdout.length).toBe(161_670)
    // And nothing leaked to the terminal — the whole point of the original bug.
    expect(consoleOut).not.toContain('abab')
  })

  it('still fails promptly when the device actually goes quiet', async () => {
    // The idle window must not become "never give up": a board that stops mid-reply
    // has to surface as an error, not a hang.
    vi.useFakeTimers()
    const board = new DribblingBoard()
    const client = new RawReplClient(board, () => undefined)
    board.payload = 'ab'.repeat(80_835)
    board.gapMs = 100
    board.stopAfter = 5 // five chunks, then silence

    const pending = client.exec('read the library', 10_000)
    const assertion = expect(pending).rejects.toThrow(/quiet/i)
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
  })

  it('reads one line instead of the file, whatever the file weighs', async () => {
    // The fix that removes the trigger: the board searches and returns a line.
    const board = new DribblingBoard()
    board.payload = '__version__ = "0.10.0"\n'
    board.gapMs = 0
    board.chunk = 4096
    const client = new RawReplClient(board, () => undefined)

    const line = await client.readFileLine('/lib/instruments.py', '__version__')
    expect(line).toBe('__version__ = "0.10.0"')
    expect(line.length).toBeLessThan(64) // not 161,670
  })

  it('returns empty for a file with no such line, rather than throwing', async () => {
    const board = new DribblingBoard()
    board.payload = '\n'
    board.gapMs = 0
    const client = new RawReplClient(board, () => undefined)
    expect(await client.readFileLine('/lib/nope.py', '__version__')).toBe('')
  })
})
