#!/usr/bin/env node
/**
 * REGENERATE docs/micropython-boards.md FROM THE BOARD INDEX (#962).
 * =============================================================================
 *
 * The doc was hand-typed, and it drifted — it claimed 219 boards from a July
 * snapshot while the shipped index had 225 from MicroPython v1.29.0. That is
 * the whole reason to generate it: a catalogue somebody has to retype is a
 * catalogue that goes quietly wrong, and a reference that is quietly wrong is
 * worse than none, because the reader trusts it.
 *
 * Source of truth is `src/renderer/public/boards/boards.json`, itself generated
 * by `build-board-index.mjs` from upstream's own `board.json` files — so this
 * doc is now two steps from MicroPython's tree and no steps from anybody's
 * memory. The curated overlay (`board-overlay.ts`) is SUMMARISED rather than
 * tabled: those boards have no upstream build target, which is the one column
 * this table exists to give.
 *
 *     node scripts/build-boards-doc.mjs
 *
 * Run it after refreshing the board index, and commit the result.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const INDEX = 'src/renderer/public/boards/boards.json'
const OVERLAY = 'src/shared/board-overlay.ts'
const OUT = 'docs/micropython-boards.md'

/** Friendly names for the ports, in the order the doc has always used them. */
const PORTS = [
  ['rp2', 'Raspberry Pi RP2 — RP2040 / RP2350'],
  ['esp32', 'Espressif ESP32 family'],
  ['esp8266', 'Espressif ESP8266'],
  ['stm32', 'STMicroelectronics STM32'],
  ['samd', 'Microchip SAMD (SAM D21 / D51)'],
  ['nrf', 'Nordic Semiconductor nRF'],
  ['mimxrt', 'NXP i.MX RT'],
  ['renesas-ra', 'Renesas RA'],
  ['alif', 'Alif Ensemble'],
  ['psoc-edge', 'Infineon PSoC Edge'],
  ['cc3200', 'Texas Instruments CC3200']
]

/** Escape a cell so a stray pipe in a vendor string cannot break the table. */
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|')

const index = JSON.parse(readFileSync(INDEX, 'utf8'))
const boards = index.boards
const overlayCount = (readFileSync(OVERLAY, 'utf8').match(/^ {4}id: '/gm) ?? []).length

const byPort = new Map()
for (const b of boards) {
  if (!byPort.has(b.port)) byPort.set(b.port, [])
  byPort.get(b.port).push(b)
}
// Any port the list above has not been told about still gets a section, rather
// than being silently dropped from a document that claims to be complete.
for (const port of byPort.keys()) {
  if (!PORTS.some(([p]) => p === port)) PORTS.push([port, port])
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const out = []

out.push('# MicroPython-compatible boards')
out.push('')
out.push('A catalogue of boards with an official MicroPython build, i.e. every board that')
out.push('ships a `board.json` in the mainline [micropython/micropython](https://github.com/micropython/micropython)')
out.push('tree. For each board: **supplier** (vendor), **board name** (product), **model**')
out.push('(the MicroPython build-target / board id you flash), and **chip type** (MCU).')
out.push('')
out.push(`- **Total boards:** ${boards.length} across ${plural(byPort.size, 'MCU port')}.`)
out.push(`- **MicroPython:** \`${index.micropython}\`.`)
out.push(`- **Source:** \`${INDEX}\`, generated from mainline \`ports/*/boards/*/board.json\`.`)
out.push(`- **Generated:** ${index.generated} — **do not edit by hand**, run \`node scripts/build-boards-doc.mjs\`.`)
out.push('')
out.push('> Notes')
out.push('> - Snakie’s **Board Finder** shows these plus ' + overlayCount + ' more that MicroPython')
out.push('>   builds nothing for but people own anyway — the Adafruit ESP32 Feather V2, the')
out.push('>   micro:bit v2, Pimoroni’s Tiny 2350 and Servo 2040 and others. They are not in')
out.push('>   this table because the one column it exists to give — the build target you')
out.push('>   flash — is precisely what they do not have. See `src/shared/board-overlay.ts`.')
out.push('> - The `ESP32_GENERIC*` and `ESP8266_GENERIC` targets cover the countless')
out.push('>   third-party ESP dev boards (NodeMCU, DOIT, HiLetgo, etc.) that share a chip.')
out.push('> - Some vendors (e.g. Pimoroni, Arduino, LEGO) also ship **extra** boards in their')
out.push('>   own MicroPython forks that are not in mainline and so are not listed here.')
out.push('> - Vendor strings are reproduced verbatim from upstream, so minor naming variants')
out.push('>   exist (e.g. "WeAct" vs "WeAct Studio").')
out.push('')
out.push('## Summary by port')
out.push('')
out.push('| Port | MCU family | Boards |')
out.push('|------|-----------|-------:|')
for (const [port, name] of PORTS) {
  const list = byPort.get(port)
  if (!list) continue
  out.push(`| \`${port}\` | ${cell(name)} | ${list.length} |`)
}
out.push(`| | **Total** | **${boards.length}** |`)
out.push('')

for (const [port, name] of PORTS) {
  const list = byPort.get(port)
  if (!list) continue
  list.sort((a, b) => (a.vendor + a.product).localeCompare(b.vendor + b.product))
  out.push(`## ${name}`)
  out.push('')
  out.push(`Port: \`${port}\` — ${plural(list.length, 'board')}.`)
  out.push('')
  out.push('| Supplier | Board name | Model (build target) | Chip |')
  out.push('|----------|-----------|----------------------|------|')
  for (const b of list) {
    out.push(`| ${cell(b.vendor)} | ${cell(b.product)} | \`${cell(b.id)}\` | ${cell(b.mcu)} |`)
  }
  out.push('')
}

writeFileSync(OUT, out.join('\n'))
console.log(`→ ${OUT}: ${boards.length} boards across ${byPort.size} ports (MicroPython ${index.micropython})`)
