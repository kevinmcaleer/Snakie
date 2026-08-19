/**
 * THE TWO LEGS OF A WEB INSTALL (#776 follow-on) — download, then write.
 * =============================================================================
 *
 * The preload owns this for the desktop (`writeFilesToBoard` in
 * `src/preload/index.ts`); this is its web twin, shared by the two web backends
 * that install things — `web-modules.ts` (a driver behind an instrument) and
 * `web-packages.ts` (a package from the Packages tab). One copy, because the
 * two had already started to drift: whichever one grew a fix, the other kept
 * the bug.
 *
 * The device is a PARAMETER rather than `window.api.device` so the rules —
 * parents before children, in order, and a failure that names the file it
 * stopped on — are testable without a browser or a board.
 */
import {
  deviceDirsFor,
  httpMipFetch,
  MipResolveError,
  type MipFetch
} from '../../../shared/mip-resolve'
import { writeFailureMessage } from '../../../shared/install-messages'
import { webCanFetch, webFetchRefusal } from './web-hosts'

/**
 * The resolver's fetch, with the browser's reach checked FIRST.
 *
 * Without this the two ways a page can be stopped — its own CSP and the
 * target's CORS policy — both surface as `TypeError: Failed to fetch`, which
 * reads as "the internet is broken" rather than "this host is not one a web
 * page can read". `unsupported` is the honest kind: the spec asks this route
 * for something it deliberately does not do.
 */
export function webMipFetch(timeoutMs?: number): MipFetch {
  const http = httpMipFetch(timeoutMs)
  return async (url: string): Promise<string> => {
    if (!webCanFetch(url)) {
      throw new MipResolveError('unsupported', webFetchRefusal(url), url)
    }
    return http(url)
  }
}

/** The slice of the device API an install needs. */
export interface InstallDevice {
  /** Create one directory. May reject if it already exists — that is fine. */
  mkdir(path: string): Promise<void>
  /** Write one file, creating or replacing it. */
  writeFile(path: string, contents: string): Promise<void>
}

/** One file to put on the board. */
export interface InstallFile {
  path: string
  contents: string
}

/** What the write leg of an install produced. Never throws — a board that
 *  refuses the files is an outcome, not an exception. */
export interface WriteOutcome {
  ok: boolean
  /** What was written, or why it couldn't be — already user-readable. */
  log: string
}

/**
 * Write `files` to `device`, creating every ancestor directory first
 * (MicroPython has no recursive `mkdir`) and reporting per-file progress.
 *
 * `onStep` matters more than it looks: over the raw REPL each file is a run of
 * hex-chunk round-trips, so a 25-file package spends a long time here and
 * silence reads as a hang.
 */
export async function writeFilesToDevice(
  name: string,
  files: readonly InstallFile[],
  device: InstallDevice,
  onStep: (message: string) => void = () => {}
): Promise<WriteOutcome> {
  if (files.length === 0) {
    return { ok: false, log: `Couldn't install ${name}: nothing was resolved to write.` }
  }
  let current = ''
  try {
    for (const dir of deviceDirsFor(files.map((f) => f.path))) {
      // An existing directory is fine — MicroPython raises EEXIST for it.
      await device.mkdir(dir).catch(() => undefined)
    }
    let done = 0
    for (const file of files) {
      current = file.path
      onStep(`Writing ${++done}/${files.length} — ${file.path}…`)
      await device.writeFile(file.path, file.contents)
    }
    return { ok: true, log: `Wrote ${files.map((f) => f.path).join(', ')}` }
  } catch (err) {
    return {
      ok: false,
      log: writeFailureMessage({
        name,
        path: current || undefined,
        detail: err instanceof Error ? err.message : String(err)
      })
    }
  }
}
