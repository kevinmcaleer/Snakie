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
import { spawn } from 'child_process'
import { promises as fs, createReadStream, createWriteStream } from 'fs'
import { basename, join } from 'path'
import type { EsptoolInfo, FlashOptions, FlashProgress, FlashResult } from './types'

/** Candidate executable names for esptool, in preference order. */
const ESPTOOL_COMMANDS = ['esptool', 'esptool.py'] as const

/** Default ESP `write_flash` offsets per family. */
const DEFAULT_OFFSET: Record<'esp32' | 'esp8266', string> = {
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
  const args = [
    '--port',
    opts.port,
    '--baud',
    baud,
    'write_flash',
    offset,
    opts.firmwarePath
  ]

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
  return { ok: true }
}

/** Copy a `.uf2` file onto the mounted RP2040 boot drive, streaming progress. */
async function flashRp2040(opts: FlashOptions, emit: Emit): Promise<FlashResult> {
  const mount = opts.mountPath
  if (!mount) {
    return {
      ok: false,
      error: 'No RP2040 boot drive selected. Hold BOOTSEL while connecting so RPI-RP2 mounts.'
    }
  }

  try {
    const dirStat = await fs.stat(mount)
    if (!dirStat.isDirectory()) {
      return { ok: false, error: `Boot drive path is not a directory: ${mount}` }
    }
  } catch {
    return { ok: false, error: `Boot drive not found: ${mount}` }
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
          emit({ kind: 'log', message: `Copying… ${pct}%` })
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
    emit({ kind: 'error', message: `UF2 copy error: ${msg}` })
    return { ok: false, error: msg }
  }

  emit({ kind: 'log', message: 'UF2 copied. The board will reboot into the new firmware.' })
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
    if (opts.board === 'rp2040') {
      result = await flashRp2040(opts, emit)
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
