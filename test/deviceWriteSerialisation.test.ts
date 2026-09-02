import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

/**
 * Concurrent writes must not interleave (#850).
 *
 * The bug this pins: `opQueue` makes each `exec` atomic, which keeps the
 * raw-REPL protocol intact, but a file write is `open` → N chunks → `close`
 * with the handle living in ONE global on the board between the steps. Two
 * writes at once interleave legally at the exec level and destroy each other —
 * the second `open` rebinds `_snk_f`, the first write's chunks go to the second
 * file or nowhere, and both files end up created and EMPTY. Which is exactly
 * what a user saw: every file present, every file 0 bytes.
 *
 * Asserted by recording the ORDER of snippets a device runs, so the test states
 * the property (no other file's open appears between mine) rather than
 * re-describing the implementation.
 */
async function deviceWithRecorder(): Promise<{
  dev: { writeFile: (p: string, c: Buffer) => Promise<void> }
  log: string[]
}> {
  const { MicroPythonDevice } = await import('../src/main/device/MicroPythonDevice')
  const dev = new MicroPythonDevice() as unknown as {
    writeFile: (p: string, c: Buffer) => Promise<void>
    eval: (code: string) => Promise<string>
    driveMount: () => Promise<string | null>
  }
  const log: string[] = []
  // Stand in for the wire: record the snippet, yield to the event loop so a
  // competing sequence gets every chance to slip in, then resolve.
  dev.eval = async (code: string): Promise<string> => {
    log.push(code)
    await new Promise((r) => setTimeout(r, 0))
    return ''
  }
  dev.driveMount = async (): Promise<string | null> => null
  return { dev, log }
}

/** The path each recorded snippet acted on, for `open` lines only. */
function opens(log: string[]): string[] {
  return log
    .filter((line) => line.includes("_snk_f=open("))
    .map((line) => /_snk_f=open\('([^']+)'/.exec(line)?.[1] ?? '?')
}

describe('concurrent device writes (#850)', () => {
  it('does not interleave two writes', async () => {
    const { dev, log } = await deviceWithRecorder()

    await Promise.all([
      dev.writeFile('/a.txt', Buffer.from('A'.repeat(4096))),
      dev.writeFile('/b.txt', Buffer.from('B'.repeat(4096)))
    ])

    // Each file is opened exactly once...
    expect(opens(log)).toHaveLength(2)

    // ...and everything between the first open and its close belongs to it.
    const firstOpen = log.findIndex((l) => l.includes("_snk_f=open("))
    const firstClose = log.findIndex((l, i) => i > firstOpen && l.includes('_snk_f.close()'))
    expect(firstClose).toBeGreaterThan(firstOpen)
    const between = log.slice(firstOpen + 1, firstClose)
    expect(
      between.some((l) => l.includes("_snk_f=open(")),
      'a second open appeared inside the first write — the handle was rebound'
    ).toBe(false)
  })

  it('writes every byte of both files', async () => {
    const { dev, log } = await deviceWithRecorder()
    await Promise.all([
      dev.writeFile('/a.txt', Buffer.from('A'.repeat(3000))),
      dev.writeFile('/b.txt', Buffer.from('B'.repeat(3000)))
    ])
    // 3000 bytes of 'A' is 0x41 repeated; count the hex actually written.
    const hexA = log
      .filter((l) => l.includes('unhexlify'))
      .join('')
      .split('41').length - 1
    expect(hexA).toBeGreaterThanOrEqual(3000)
  })

  it('a failed write does not wedge the queue for the next one', async () => {
    const { dev, log } = await deviceWithRecorder()
    const raw = dev as unknown as { eval: (c: string) => Promise<string> }
    const good = raw.eval
    raw.eval = async (code: string): Promise<string> => {
      if (code.includes("_snk_f=open('/bad.txt'")) throw new Error('nope')
      return good(code)
    }
    await expect(dev.writeFile('/bad.txt', Buffer.from('x'))).rejects.toThrow()
    // The lock must have been released, or this would hang rather than fail.
    await dev.writeFile('/fine.txt', Buffer.from('y'))
    expect(opens(log)).toContain('/fine.txt')
  })
})
