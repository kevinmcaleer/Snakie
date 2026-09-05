/**
 * WRITE A DEVICE FILE ALL-OR-NOTHING (#864)
 * =============================================================================
 *
 * A driver install writes each file straight to its final path. Interrupt it —
 * a disconnect, a cancel, an error on any one file — and the partially-written
 * file stays on the board **under its real name**, and nothing knows it is
 * incomplete. The next import of that package then fails with a `SyntaxError`
 * pointing into a vendor file, which reads as "the library is broken" rather
 * than "the install didn't finish".
 *
 * That is not hypothetical. A reported ESP32 traceback blamed
 * `/lib/lsm6dsox.py` line 159 — a line that is `raise ValueError(...)` in the
 * real 362-line file, which parses cleanly. The copy on the board was a valid
 * prefix of a 12 KB file and nothing else.
 *
 * So: write to a temporary name beside the target, check what landed, and only
 * then move it into place. An interrupted install now leaves a stray temp file
 * — inert, overwritten by the next attempt, and removed on the way out — and
 * the real file is either the old one or the new one.
 *
 * HONEST LIMITS. `os.rename` onto an existing name overwrites on littlefs and
 * fails with EEXIST on FAT, and Snakie supports boards with both. Where it
 * fails we remove and retry, which leaves a one-round-trip window in which the
 * file is ABSENT. That is a real gap, but it is a different and far better
 * failure: a missing module raises `ImportError: no module named x`, which says
 * what happened, instead of a syntax error deep inside someone else's library.
 *
 * Pure over an injected {@link AtomicOps}, so the desktop install path (which
 * talks over `ipcRenderer`) and the renderer's folder transfer (which talks
 * over `window.api`) share ONE implementation, and it unit-tests in node.
 */

/**
 * The device file operations this needs, beyond the write itself — which the
 * caller passes in per file, because the text and bytes channels are different
 * calls and choosing between them is the caller's business.
 */
export interface AtomicOps {
  /** Size of `path` in bytes. May throw or be unavailable — see below. */
  stat: (path: string) => Promise<{ size: number }>
  rename: (from: string, to: string) => Promise<void>
  remove: (path: string) => Promise<void>
}

/**
 * Suffix marking a half-written file. Deliberately unlovely and unlikely to
 * collide with anything a user would name, and it sorts next to its target in a
 * directory listing so a stray one is obvious rather than mysterious.
 */
export const TEMP_SUFFIX = '.snk-part'

/**
 * The temporary name for `path` — same directory, so the rename is a rename and
 * not a copy across filesystems.
 */
export function tempPathFor(path: string): string {
  return `${path}${TEMP_SUFFIX}`
}

/** Best-effort cleanup; a failure here must never mask the real error. */
async function tryRemove(ops: AtomicOps, path: string): Promise<void> {
  try {
    await ops.remove(path)
  } catch {
    // The port may already be gone — which is exactly when this runs. The next
    // install overwrites the temp anyway, so a leftover is untidy, not harmful.
  }
}

/**
 * Move `tmp` onto `target`, coping with a filesystem that will not rename onto
 * an existing name.
 */
async function commit(ops: AtomicOps, tmp: string, target: string): Promise<void> {
  try {
    await ops.rename(tmp, target)
    return
  } catch {
    // FAT refuses this; littlefs does not. Fall through to remove-and-retry.
  }
  await tryRemove(ops, target)
  await ops.rename(tmp, target)
}

/**
 * Check the bytes actually arrived, when the board will say.
 *
 * A size mismatch is a hard failure: it means a write returned without an error
 * having written the wrong thing, which is the silent corruption this whole
 * module exists to stop. A `stat` that THROWS is not — some paths (a mounted
 * CIRCUITPY drive, a board mid-reset) can't answer, and refusing to install
 * because the check itself was unavailable would trade a rare bug for a common
 * one.
 */
async function verify(ops: AtomicOps, tmp: string, expectedBytes: number): Promise<void> {
  let size: number
  try {
    size = (await ops.stat(tmp)).size
  } catch {
    return
  }
  if (typeof size !== 'number' || Number.isNaN(size)) return
  if (size !== expectedBytes) {
    throw new Error(
      `short write: ${size} of ${expectedBytes} bytes arrived. The board may have run out of space.`
    )
  }
}

/**
 * Write `target` all-or-nothing.
 *
 * `write` is handed the temporary path and must write the whole file there —
 * the caller owns the choice of text or bytes channel. `expectedBytes` is the
 * byte length that should land (`Buffer.byteLength` for text, not `.length`).
 *
 * Throws on failure, having removed the temporary first.
 */
export async function writeAtomically(
  ops: AtomicOps,
  target: string,
  expectedBytes: number,
  write: (tmpPath: string) => Promise<void>
): Promise<void> {
  const tmp = tempPathFor(target)
  try {
    await write(tmp)
    await verify(ops, tmp, expectedBytes)
    await commit(ops, tmp, target)
  } catch (err) {
    await tryRemove(ops, tmp)
    throw err
  }
}
