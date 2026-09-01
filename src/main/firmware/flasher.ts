const execFileAsync = promisify(execFile)

/**
 * Firmware-flashing engine (issue #14).
 *
 * Two strategies, chosen by {@link FlashOptions.board}:
 *
 *  - **ESP (esp32 / esp8266)** — shells out to the external `esptool`
 *    executable via `child_process.spawn`, streaming its stdout/stderr to the
 *    renderer line-by-line. esptool is a *prerequisite the user installs*; we
 *    never bundle it. If it is missing we fail fast with an actionable message.
 *
 *  - **RP2040 (UF2)** — copies the selected `.uf2` file onto the mounted
 *    `RPI-RP2` boot drive using plain Node `fs`. The board reboots itself once
 *    the copy completes, so there is no tool to invoke.
 *
 * Progress is delivered through an injected `emit` callback (the IPC layer
 * forwards it to the renderer) so this module has no Electron dependency and is
 * easy to reason about in isolation.
 */
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { classifyBootOutput } from '../../shared/boot-check'
import { describeEspImageCheck, verifyEspImage } from './esp-image'
import { parseEsptoolIdentity, type BoardIdentity } from '../../shared/esptool-identify'
import { promises as fs, createReadStream, createWriteStream } from 'fs'
import { basename, join } from 'path'
import type { EsptoolInfo, FlashOptions, FlashProgress, FlashResult } from './types'

/** Candidate executable names for esptool, in preference order. */
const ESPTOOL_COMMANDS = ['esptool', 'esptool.py'] as const

/** Default ESP `write_flash` offsets per family. */
export const DEFAULT_OFFSET: Record<'esp32' | 'esp8266', string> = {
  esp32: '0x1000',
  esp8266: '0x0'
}

/** A sink for streamed progress lines. */
export type Emit = (p: FlashProgress) => void

/**
 * Run a command to completion, streaming combined stdout/stderr to `emit` one
 * line at a time. Resolves with the exit code; rejects only if the process
 * could not be spawned at all (surfaced separately so callers can detect a
 * missing executable).
 */
function runStreaming(
  command: string,
  args: string[],
  emit: Emit
): Promise<{ code: number | null; spawnError?: Error }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch (err) {
      resolve({ code: null, spawnError: err instanceof Error ? err : new Error(String(err)) })
      return
    }

    const pump =
      (kind: 'log' | 'error') =>
      (buf: Buffer): void => {
        for (const line of buf.toString().split(/\r?\n/)) {
          if (line.length > 0) emit({ kind, message: line })
        }
      }

    child.stdout?.on('data', pump('log'))
    child.stderr?.on('data', pump('error'))
    child.on('error', (err) => resolve({ code: null, spawnError: err }))
    child.on('close', (code) => resolve({ code }))
  })
}

/**
 * Probe for the external `esptool` prerequisite by attempting `--version`.
 * Returns `{ available: false }` when neither candidate command runs.
 */
/**
 * esptool's command spelling, chosen from its version (#680).
 *
 * v5 renamed the subcommands to hyphens and prints a deprecation warning for the
 * underscore forms on every run:
 *
 *   Warning: Deprecated: Command 'write_flash' is deprecated. Use 'write-flash'.
 *
 * A deprecation is a removal notice, so v6 dropping the old spelling would break
 * every ESP flash at once — and meanwhile it puts two alarming yellow warnings in
 * front of someone whose flash is going fine.
 *
 * An unreadable or absent version keeps the UNDERSCORE form: it works on every
 * released version to date, so it is the safe guess when we cannot tell. Exported
 * for tests — this is the kind of thing that should not need a board to verify.
 */
export function esptoolCommandStyle(version?: string): 'hyphen' | 'underscore' {
  const m = /\bv?(\d+)\./.exec(version ?? '')
  const major = m ? Number(m[1]) : Number.NaN
  return Number.isFinite(major) && major >= 5 ? 'hyphen' : 'underscore'
}

/** `erase_flash` / `erase-flash` for the detected esptool. */
export function eraseFlashCommand(version?: string): string {
  return esptoolCommandStyle(version) === 'hyphen' ? 'erase-flash' : 'erase_flash'
}

/** `write_flash` / `write-flash` for the detected esptool. */
export function writeFlashCommand(version?: string): string {
  return esptoolCommandStyle(version) === 'hyphen' ? 'write-flash' : 'write_flash'
}

/**
 * The `--flash-mode` / `--flash-size` FLAGS, which renamed alongside the
 * subcommands in v5 (`--flash_mode` → `--flash-mode`).
 *
 * Passing the v5 spelling to a v4 esptool is not a deprecation warning, it is an
 * unrecognised argument and a failed flash — so these follow the same version
 * rule as the subcommand, rather than being hardcoded to whatever the machine
 * that wrote this happened to have.
 */
export function flashOptionFlag(name: 'flash-mode' | 'flash-size', version?: string): string {
  return esptoolCommandStyle(version) === 'hyphen' ? `--${name}` : `--${name.replace('-', '_')}`
}

export async function detectEsptool(): Promise<EsptoolInfo> {
  for (const command of ESPTOOL_COMMANDS) {
    const result = await new Promise<EsptoolInfo | null>((resolve) => {
      let stdout = ''
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(command, ['version'], { windowsHide: true })
      } catch {
        resolve(null)
        return
      }
      child.stdout?.on('data', (b: Buffer) => (stdout += b.toString()))
      child.stderr?.on('data', (b: Buffer) => (stdout += b.toString()))
      child.on('error', () => resolve(null))
      child.on('close', (code) => {
        if (code === 0) {
          const version = stdout.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim()
          resolve({ available: true, command, version })
        } else {
          resolve(null)
        }
      })
    })
    if (result) return result
  }
  return { available: false }
}

/** Validate that the firmware file exists and is a regular file. */
async function assertFirmwareFile(path: string): Promise<void> {
  let s: import('fs').Stats
  try {
    s = await fs.stat(path)
  } catch {
    throw new Error(`Firmware file not found: ${path}`)
  }
  if (!s.isFile()) throw new Error(`Firmware path is not a file: ${path}`)
}

/** Flash an ESP board by shelling out to esptool. */
async function flashEsp(opts: FlashOptions, emit: Emit): Promise<FlashResult> {
  if (!opts.port) {
    return { ok: false, error: 'No serial port selected for the ESP board.' }
  }

  const tool = await detectEsptool()
  if (!tool.available || !tool.command) {
    const msg =
      'esptool is not installed or not on PATH. Install it with `pip install esptool` ' +
      '(or `pipx install esptool`) and try again. Snakie does not bundle esptool.'
    emit({ kind: 'error', message: msg })
    return { ok: false, error: msg }
  }

  const offset = opts.offset ?? DEFAULT_OFFSET[opts.board === 'esp8266' ? 'esp8266' : 'esp32']
  const baud = String(opts.baud ?? 460800)
  // `--chip` when we know it: auto-detect is usually right, but naming the chip
  // removes a guess on a board that answers slowly.
  const base = ['--port', opts.port, '--baud', baud]
  if (opts.chip) base.unshift('--chip', opts.chip)

  // Erase as part of the WRITE, not as a separate pass (#829 parity).
  //
  // Snakie used to run `erase-flash` and then `write-flash` as two invocations.
  // Thonny — which people successfully flash these same boards with — issues
  // ONE: `write_flash --erase-all …`. That difference is not cosmetic. Two
  // invocations mean two connections, and a board that needs BOOT held while
  // RESET is tapped has to be coaxed into download mode TWICE; the second
  // connect is exactly where it fails, after the flash has already been erased,
  // which leaves the board emptier than it started.
  //
  // `--erase-all` also erases the whole chip (not just the write areas), which
  // is the behaviour the separate pass was there for in the first place.
  const flashArgs = [
    writeFlashCommand(tool.version),
    // Pinned rather than left to esptool's implicit default, which its own
    // `--help` does not state and which has moved between versions. `keep`
    // honours the header the firmware was built with — the same thing Thonny
    // pins — so an image's declared flash mode and size survive the write.
    flashOptionFlag('flash-mode', tool.version),
    'keep',
    flashOptionFlag('flash-size', tool.version),
    'keep'
  ]
  if (opts.eraseFirst) flashArgs.push('--erase-all')

  const args = [...base, ...flashArgs, offset, opts.firmwarePath]

  // Check the FILE before writing it (#840). esptool's `Hash of data verified`
  // only proves the flash matches the file it was handed, so a download that
  // arrives with the right length and the wrong bytes flashes cleanly, verifies
  // cleanly, and bricks the board -- the ESP32's own bootloader is the first
  // thing to notice, hours later, and all it says is "Image hash failed". The
  // image carries a SHA-256 of itself; checking it here costs milliseconds and
  // moves that discovery to before the erase rather than after it.
  const imageCheck = verifyEspImage(await fs.readFile(opts.firmwarePath), Number(offset))
  // Only when it PASSES: on failure the refusal below says the same thing with
  // more of it, and three lines repeating one fact reads as three problems.
  if (imageCheck.kind !== 'bad') {
    emit({ kind: 'log', message: describeEspImageCheck(imageCheck) })
  }
  if (imageCheck.kind === 'bad') {
    const msg =
      `Refusing to flash ${basename(opts.firmwarePath)}: ${imageCheck.reason}. ` +
      'The file is damaged, so writing it would leave the board unable to boot. ' +
      'This is a bad copy of the firmware, not a fault with your board — ' +
      'download it again and retry.'
    emit({ kind: 'error', message: msg })
    return { ok: false, error: msg }
  }

  // Say plainly what is about to happen, before the esptool line that says it
  // in argv. Three flashes in a row that "succeed" and leave a dead board all
  // came down to one of these three facts being different from what the dialog
  // implied — the file, the address, or whether the flash was erased first —
  // and none of them were legible without reading an argv by eye.
  emit({
    kind: 'log',
    message:
      `Flashing ${basename(opts.firmwarePath)} to ${opts.port} at ${offset}` +
      `, ${opts.eraseFirst ? 'ERASING the whole flash first' : 'WITHOUT erasing first'}.`
  })
  emit({ kind: 'log', message: `Using ${tool.command}${tool.version ? ` (${tool.version})` : ''}` })
  emit({ kind: 'log', message: `> ${tool.command} ${args.join(' ')}` })

  const { code, spawnError } = await runStreaming(tool.command, args, emit)
  if (spawnError) {
    const msg = `Failed to launch ${tool.command}: ${spawnError.message}`
    emit({ kind: 'error', message: msg })
    return { ok: false, error: msg }
  }
  if (code !== 0) {
    const msg = `esptool exited with code ${code ?? 'null'}.`
    emit({ kind: 'error', message: msg })
    return { ok: false, error: msg }
  }
  emit({ kind: 'log', message: 'Flash complete.' })

  // ...and then ASK THE BOARD (#827). esptool exits 0 for a flash whose result
  // cannot boot, so `Flash complete` on its own is a claim about the tool, not
  // about the board. We still own the port; listening costs a few seconds and
  // turns an evening of detective work into one line.
  await reportBootOutcome(opts.port, emit)
  return { ok: true }
}

/** How long to listen for the board's boot output before giving up on it. */
const BOOT_LISTEN_MS = 4000

/**
 * Reset the freshly-flashed board and say what it printed.
 *
 * STRICTLY ADVISORY. The flash has already succeeded by the time this runs, and
 * nothing here may change that: every failure path is swallowed, and silence is
 * reported as silence. A board on native USB re-enumerates after flashing and
 * will not be on this port at all — that is not an error, it is just nothing to
 * say.
 */
async function reportBootOutcome(port: string, emit: Emit): Promise<void> {
  let text = ''
  try {
    text = await readBootOutput(port)
  } catch {
    // No port, still busy, no serialport binding — nothing to report.
    return
  }
  const verdict = classifyBootOutput(text)
  // Both are `log`, never `error`: the flash genuinely succeeded, and calling a
  // boot-loop an error would contradict the verified write the user just saw.
  if (verdict.kind === 'running' || verdict.kind === 'bootloop') {
    emit({ kind: 'log', message: verdict.message })
  }
}

/**
 * Open `port`, pulse the board's reset line, and collect what it says.
 *
 * The reset matters: esptool has already hard-reset the board on its way out,
 * so by the time the port is reopened the banner has long gone. Toggling RTS
 * (which drives EN) makes the board boot again with us listening — the same
 * line esptool itself drives, and 115200 because that is the ESP32 ROM's fixed
 * boot-log rate whatever the flash baud was.
 */
async function readBootOutput(port: string): Promise<string> {
  const { SerialPort } = await import('serialport')
  return new Promise<string>((resolve) => {
    let buf = ''
    let done = false
    const sp = new SerialPort({ path: port, baudRate: 115200, autoOpen: false })
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(backstop)
      try {
        sp.close(() => undefined)
      } catch {
        // Already closed.
      }
      resolve(buf)
    }
    // A backstop, in case a `set()` callback never fires on some driver.
    const backstop = setTimeout(finish, BOOT_LISTEN_MS + 1000)
    sp.on('error', finish)
    sp.open((err) => {
      if (err) {
        finish()
        return
      }
      sp.on('data', (d: Buffer) => {
        buf += d.toString('latin1')
      })
      // EN low, then release: the board reboots with the port already open.
      sp.set({ dtr: false, rts: true }, () => {
        setTimeout(() => {
          sp.set({ dtr: false, rts: false }, () => {
            setTimeout(finish, BOOT_LISTEN_MS)
          })
        }, 150)
      })
    })
  })
}

/**
 * Copy a firmware file onto a mounted mass-storage boot drive, streaming
 * progress. Used by BOTH the RP2040 (a `.uf2` onto the `RPI-RP2` BOOTSEL volume)
 * and the BBC micro:bit (a `.hex` onto the `MICROBIT` DAPLink volume) — same
 * mechanism, board-specific wording.
 */
async function flashDriveCopy(opts: FlashOptions, emit: Emit): Promise<FlashResult> {
  const microbit = opts.board === 'microbit'
  const fileKind = microbit ? '.hex' : 'UF2'
  const mount = opts.mountPath
  if (!mount) {
    return {
      ok: false,
      error: microbit
        ? 'No micro:bit drive selected. Connect the micro:bit so the MICROBIT drive mounts.'
        : 'No RP2040 boot drive selected. Hold BOOTSEL while connecting so RPI-RP2 mounts.'
    }
  }

  try {
    const dirStat = await fs.stat(mount)
    if (!dirStat.isDirectory()) {
      return { ok: false, error: `Drive path is not a directory: ${mount}` }
    }
  } catch {
    return { ok: false, error: `Drive not found: ${mount}` }
  }

  const dest = join(mount, basename(opts.firmwarePath))
  emit({ kind: 'log', message: `Copying ${opts.firmwarePath}` })
  emit({ kind: 'log', message: `     -> ${dest}` })

  try {
    const { size } = await fs.stat(opts.firmwarePath)
    await new Promise<void>((resolve, reject) => {
      const read = createReadStream(opts.firmwarePath)
      const write = createWriteStream(dest)
      let copied = 0
      let lastPct = -1
      read.on('data', (chunk) => {
        copied += chunk.length
        const pct = size > 0 ? Math.floor((copied / size) * 100) : 0
        if (pct !== lastPct && pct % 10 === 0) {
          lastPct = pct
          emit({ kind: 'log', message: `Copying… ${pct}%`, percent: pct })
        }
      })
      read.on('error', reject)
      write.on('error', reject)
      write.on('finish', () => resolve())
      read.pipe(write)
    })
  } catch (err) {
    // The board commonly reboots and unmounts mid-write; surface the raw error
    // but note this may still indicate success on real hardware.
    const msg = err instanceof Error ? err.message : String(err)
    emit({ kind: 'error', message: `${fileKind} copy error: ${msg}` })
    return { ok: false, error: msg }
  }

  emit({
    kind: 'log',
    message: microbit
      ? 'Firmware copied. The micro:bit will flash it and reboot (the yellow LED blinks during write).'
      : 'UF2 copied. The board will reboot into the new firmware.'
  })
  return { ok: true }
}

/**
 * Flash firmware to a device. Validates inputs, dispatches to the ESP or UF2
 * strategy, and always emits a terminal `done` progress event reflecting the
 * outcome.
 */
export async function flash(opts: FlashOptions, emit: Emit): Promise<FlashResult> {
  let result: FlashResult
  try {
    await assertFirmwareFile(opts.firmwarePath)
    if (opts.board === 'rp2040' || opts.board === 'microbit') {
      result = await flashDriveCopy(opts, emit)
    } else {
      result = await flashEsp(opts, emit)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit({ kind: 'error', message: msg })
    result = { ok: false, error: msg }
  }
  emit({
    kind: 'done',
    ok: result.ok,
    message: result.ok ? 'Done.' : (result.error ?? 'Flashing failed.')
  })
  return result
}

/**
 * Ask a connected ESP what it is, before anything is written to it.
 *
 * `esptool flash-id` reports the exact part, its features — **including whether
 * it has PSRAM** — and the real flash size. That is precisely the information
 * the flash dialog otherwise asks the user to supply from memory, and which for
 * PSRAM they often have no way to know: MicroPython publishes `ESP32_GENERIC`
 * and `ESP32_GENERIC-SPIRAM` separately, and nothing in the firmware catalog
 * says which one a given board wants.
 *
 * Read-only. It uploads the stub and reads the flash id; it writes nothing.
 * Failure is not an error the caller has to handle — an unplugged board, a busy
 * port or a board not in download mode all come back as an empty identity,
 * because "we could not ask" and "the board has no PSRAM" must never look alike.
 */
export async function identifyBoard(port: string): Promise<BoardIdentity> {
  const tool = await detectEsptool()
  if (!tool.available || !tool.command) return {}
  try {
    const { stdout } = await execFileAsync(
      tool.command,
      ['--port', port, '--baud', '115200', flashIdCommand(tool.version)],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }
    )
    return parseEsptoolIdentity(String(stdout))
  } catch (err) {
    // esptool exits non-zero when it cannot connect, and still prints the chip
    // banner in some of those cases — so parse what it managed to say.
    const out = err as { stdout?: string; stderr?: string }
    return parseEsptoolIdentity(`${out.stdout ?? ''}\n${out.stderr ?? ''}`)
  }
}

/** `flash_id` / `flash-id` for the detected esptool. */
export function flashIdCommand(version?: string): string {
  return esptoolCommandStyle(version) === 'hyphen' ? 'flash-id' : 'flash_id'
}
