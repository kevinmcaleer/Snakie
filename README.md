# Snakie

A modern, cross-platform **MicroPython editor**.

Snakie is a clean IDE for writing MicroPython code and working with connected
microcontrollers, wrapped in a photoreal **Skeuomorph** interface (brushed metal,
green felt, ruled paper and recessed glass) with a dark mode. It is built on
Electron so it runs on Windows, macOS and Linux, and updates itself.

Beyond editing and the REPL, it can **visualise your board** — parsing your code
to draw the actual pinout — and drive on-screen **instruments** (oscilloscope,
multimeter, plotter) from a running program.

## Download

Grab the latest installer for your platform from the
[**Releases**](https://github.com/kevinmcaleer/Snakie/releases/latest) page:

- 🪟 Windows (x64) — `Snakie.Setup.<version>.exe`
- 🍎 macOS (Apple Silicon) — `Snakie-<version>-arm64.dmg`
- 🍎 macOS (Intel) — `Snakie-<version>.dmg`
- 🐧 Linux (x64) — `Snakie-<version>.AppImage` or `snakie_<version>_amd64.deb`

> Windows and Linux are x64 only for now; Linux arm64 (Raspberry Pi) and
> Windows arm64 are not yet built — see "Building installers" below for why.

## Features

### Editor

- ✏️ Monaco-based editor with MicroPython syntax highlighting, autocomplete and
  optional **AI ghost-text** suggestions
- 🧩 Tabbed multi-file editing
- 🔍 **Find & Replace** — case / whole-word / regex toggles, live match count,
  draggable dialog
- ✅ **YAML / JSON validation** with squiggles, a Problems panel and an autofix
- 🎨 Skeuomorph **ruled-paper** editor, with a light/dark theme toggle

### Device & REPL

- 🔌 Connect to a MicroPython device over serial (raw-REPL protocol)
- ▶️ **Run** and **Stop** — Stop also **soft-resets** the board when nothing's
  running
- 🐚 Interactive shell (REPL) with a live serial **Plotter** alongside the console
- 🗂️ Browse / create / rename / delete files locally and on the device
  (Thonny-style)
- 📦 Install MicroPython packages (`mip`) and 📡 flash firmware (built-in board
  catalog)

### Board View & Instruments

- 🔭 A live **Board View** window that parses your code for pin usage and draws the
  **actual board** — Raspberry Pi Pico 2 W, ESP32, Pimoroni Pico Plus 2 / Tiny 2040
  / Tiny 2350, plus your own board definitions
- 🕸️ A **node graph** of every connection by type (input / output / PWM / I²C / SPI
  / PIO / ADC) with live pin values, **zoom / rotate / export** (SVG · PNG · PDF),
  and a visual **Board Creator** for custom boards
- 📟 **Oscilloscope, Multimeter and Plotter** instruments — dockable or floating —
  fed live and **non-invasively** by a tiny MicroPython telemetry library
  (`scope()` / `meter()` / `plot()`), one-click installable to your board

### Parts Library & Part Editor

- 🧩 A **Parts Library** of portable, community-authored parts — each a folder with
  a human-readable `parts.yml` — browsable, searchable, and installable/updatable
  from a master **community registry** ([`docs/parts-library.md`](docs/parts-library.md))
- 🛠️ A visual **Part Editor** (schematic ⇄ breadboard) to author parts: pins with
  type + capabilities, castellated/regular pads, mounting holes, buttons, 2.54 mm
  grid snap, and a footprint + life-like preview ([`docs/part-editor.md`](docs/part-editor.md))
- 🔌 **Breadboard & Schematic** board views (alongside the node graph) that place
  parts + the microcontroller on one canvas — pick parts from a docked library
  panel — and wire them up: **node-RED-style noodles** in Breadboard, **orthogonal
  auto-routed** lines in Schematic (red power / white ground / colour-picked
  signals), with the pins your code uses highlighted, saved to a `robot.yml`
  project file ([`docs/robot-definition.md`](docs/robot-definition.md))

### Workflow

- 🌳 Built-in version control (Git, VS Code-style)
- 🤖 Integrated LLM chat pane
- 🔔 In-app update notifications when a new version is ready

## Tech stack

- **Electron** — cross-platform desktop shell
- **Vite + React + TypeScript** — renderer UI
- **Monaco Editor** — code editing
- **node-serialport** — device communication (MicroPython raw-REPL protocol)
- **electron-builder** — packaging for Windows / macOS / Linux

## Development

Snakie uses [electron-vite](https://electron-vite.org/) with the standard
`src/main`, `src/preload`, `src/renderer` three-process layout.

```bash
npm install       # install dependencies
npm run dev       # start the app with hot reload
npm run build     # build main, preload and renderer into out/
npm run lint      # lint with ESLint
npm run typecheck # type-check main/preload and renderer
npm run format    # format with Prettier
```

> Note: `npm run dev` opens an Electron window and requires a display.

## Building installers

Snakie is packaged with [electron-builder](https://www.electron.build/).

```bash
npm run pack   # build an unpacked app in dist/ (quick local sanity check)
npm run dist   # build installers for the current OS into dist/
```

Per-OS targets (run on the matching OS):

```bash
npm run dist:win    # Windows NSIS installer
npm run dist:mac    # macOS dmg
npm run dist:linux  # Linux AppImage + deb
```

Each platform's installers are produced on that platform — cross-building
across operating systems is not supported here. On a tag push (`v*`) the
[release workflow](.github/workflows/release.yml) builds every target on a CI
matrix and collects them into a single draft GitHub Release.

### Build targets

| Platform | Arch  | Artifacts                          | CI runner          |
| -------- | ----- | ---------------------------------- | ------------------ |
| macOS    | arm64 | `Snakie-<v>-arm64.dmg`             | `macos-latest`     |
| macOS    | x64   | `Snakie-<v>.dmg`                   | `macos-latest`     |
| Linux    | x64   | `.AppImage` + `_amd64.deb`         | `ubuntu-latest`    |
| Windows  | x64   | `Snakie.Setup.<v>.exe`             | `windows-latest`   |

Notes on arch coverage:

- **macOS** ships two per-arch dmgs (Apple Silicon + Intel) rather than one
  universal binary. Universal merging of the native `serialport` module is more
  fragile, and two per-arch dmgs are smaller. Both build on the arm64
  `macos-latest` runner because `@serialport/bindings-cpp` provides a universal
  (`darwin-x64+arm64`) prebuilt binary, so no per-arch recompilation is needed.
- **Linux arm64 (Raspberry Pi) is not yet built** — deferred. Even on a native
  `ubuntu-24.04-arm` runner, electron-builder's bundled `fpm` (for `.deb`) is an
  x86 binary that won't execute on arm64, and the `serialport` native rebuild
  emits the x86-only `-m64` flag that arm64 g++ rejects. Producing arm64 Linux
  packages needs dedicated work (AppImage-only + arm64 fpm/appimagetool + a
  clean serialport rebuild).
- **Windows is x64 only.** GitHub's hosted Windows runners are x64 and there is
  no native arm64 Windows runner in the hosted pool, so a reliable arm64 nsis
  installer can't be produced here yet. (`serialport` does ship a `win32-arm64`
  prebuild, so this is a CI-infrastructure limitation, not a code one — revisit
  if/when an arm64 Windows runner becomes available.)

> macOS builds are **code-signed** (Developer ID Application) and **notarized**, so
> Gatekeeper accepts them and the in-app updater can apply updates (#47); Windows
> and Linux builds are currently unsigned. The app icon (`build/icon.png`, source
> `build/icon.svg`) is a drafted placeholder logo — fine to replace with final
> artwork (#46).

## Status

🚀 **v0.13.0 released** — signed + notarized macOS builds alongside Windows and
Linux. On top of the original editor / REPL / device tooling, recent releases added
the **Skeuomorph** redesign, the **Board View** (node-graph pinout, multi-board +
custom boards, viewport + export, Board Creator), the **Oscilloscope / Multimeter /
Plotter** instruments, and the **MicroPython instruments telemetry library** that
feeds them live from a running program. See
[`CHANGELOG.md`](CHANGELOG.md) for the full history and
[`docs/`](docs/) for the design + plugin + board + instruments guides.

> ⚠️ Many features are build-, type- and unit-test-verified but the **on-device**
> paths (live values, the instruments, firmware flashing, package install) need a
> real MicroPython board to fully validate. The LLM chat needs an Anthropic API
> key; the package installer needs network access.

## License

MIT
