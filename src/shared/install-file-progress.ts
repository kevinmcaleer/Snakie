/**
 * Per-file detail on a library install (#895).
 * =============================================================================
 *
 * Installing the Arduino Modulino package copies 22 files over the raw REPL,
 * plus three dependency packages it pulls in transitively. That takes a while —
 * and with nothing moving on screen there is no way to tell a slow install from
 * a dead one. The reported symptom was "installing the modulino library appears
 * to hang", and the documented workaround for a hang is Disconnect, which
 * mid-write is exactly what #864 exists to stop being destructive.
 *
 * The information already existed. `writeFilesToBoard` has always reported every
 * file as it went:
 *
 *     onStep(`Writing ${++done}/${files.length} — ${file.path}…`)
 *
 * but only as prose, inside the progress event's free-text `message`. Anything
 * wanting the file, the index or the total had to parse that sentence back
 * apart, which is not a thing to build on. So the same facts travel
 * structurally as well, and the sentence stays exactly as it was for the panels
 * that display it.
 *
 * Mixed into BOTH install progress payloads — modules and packages — because
 * they share one writer underneath, and the fix belongs there rather than in
 * each caller.
 */

/** What a file is doing, mirroring the device queue's own step states. */
export type InstallFileState = 'running' | 'done' | 'error'

/** One file an install will write. */
export interface InstallFileEntry {
  /** Absolute on-device path, e.g. `/lib/modulino/__init__.py`. */
  path: string
  /**
   * The DEPENDENCY package that brought this file, when it is not one of the
   * package the user actually asked for.
   *
   * Set by whoever built the plan, because that is the only place both halves
   * are known — and it is set rather than derived because "which package is
   * root" is not the same question for the two resolvers: a `mip` resolution
   * lists the root FIRST and the Adafruit bundle lists it LAST. Recording the
   * answer once beats two call sites each guessing at it.
   *
   * Absent means "this is the package that was asked for", which is why the
   * common case — a one-file bundled driver — needs nothing at all.
   */
  dependency?: string
}

/**
 * The structured half of an install progress event. Every field is optional:
 * an install emits notes, errors and lifecycle states that have nothing to do
 * with any particular file.
 */
export interface InstallFileProgress {
  /**
   * Every file this install will write, in the order they will be written.
   * Emitted ONCE, before the first write — a progress list that grows as it
   * goes cannot show how much is left, which is the question being asked.
   */
  files?: readonly InstallFileEntry[]
  /** Index into {@link files} of the file this event concerns. */
  fileIndex?: number
  /** What just happened to it. */
  fileState?: InstallFileState
}

/**
 * A package spec, shortened to something worth putting in a list.
 *
 * Specs arrive in the shapes `mip` accepts: a bare index name (`lsm6dsox`), a
 * `github:` path (`github:arduino/arduino-modulino-mpy`), or a URL ending in a
 * file. The tail is the part that identifies it; the host, the owner and the
 * `.py` are shared by everything around it and only cost width.
 */
export function packageDisplayName(spec: string): string {
  const trimmed = spec.trim()
  const bare = trimmed
    .replace(/^[a-z][a-z0-9+.-]*:/i, '') // github: / gitlab: / https:
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
  const tail = bare.split('/').filter(Boolean).pop() ?? ''
  return tail.replace(/\.(py|mpy|json)$/i, '') || trimmed
}

/**
 * A short label for one file in the progress list.
 *
 * The device path, minus the `/lib/` every library install shares — twenty-two
 * rows all starting with the same five characters spend the width that tells
 * them apart. A path outside `/lib` is left whole, because then the location IS
 * the information.
 */
export function installStepLabel(devicePath: string): string {
  return devicePath.startsWith('/lib/') ? devicePath.slice('/lib/'.length) : devicePath
}

/**
 * The step labels for a whole install, one per file, in write order.
 *
 * Files from a dependency are named by the package that brought them. That is
 * the other half of the reported bug: a `modulino` install also fetches
 * `lsm6dsox`, `ltr-381rgb-01` and `HS3003`, and an unlabelled row part-way down
 * a 25-file list reads as "still stuck on modulino" when it is really working
 * through something the user never asked for by name — which is exactly the
 * moment they most want to know why.
 */
export function installStepLabels(files: readonly InstallFileEntry[]): string[] {
  return files.map((file) =>
    file.dependency
      ? `${packageDisplayName(file.dependency)} — ${installStepLabel(file.path)}`
      : installStepLabel(file.path)
  )
}

/**
 * The sentence that announces the write leg, before the first file goes down.
 *
 * It counts the dependency files separately because that count is the answer to
 * "why is this taking so long for one small driver".
 */
export function installPlanMessage(files: readonly InstallFileEntry[]): string {
  const total = files.length
  const deps = new Set(files.map((f) => f.dependency).filter(Boolean))
  const plural = total === 1 ? '' : 's'
  if (deps.size === 0) return `Writing ${total} file${plural}…`
  const packages = deps.size === 1 ? 'package' : 'packages'
  return `Writing ${total} file${plural}, including ${deps.size} dependency ${packages}…`
}
