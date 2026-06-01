# Snakie

A modern, cross-platform **MicroPython editor**.

Snakie is a clean, uncluttered IDE for writing MicroPython code and working with
connected MicroPython devices. It is built on Electron so it runs on Windows,
macOS and Linux, and updates easily.

## Download

Grab the latest installer for your platform from the
[**Releases**](https://github.com/kevinmcaleer/Snakie/releases/latest) page:

- 🪟 Windows (x64) — `Snakie.Setup.<version>.exe`
- 🍎 macOS (Apple Silicon) — `Snakie-<version>-arm64.dmg`
- 🍎 macOS (Intel) — `Snakie-<version>.dmg`
- 🐧 Linux (x64) — `Snakie-<version>.AppImage` or `snakie_<version>_amd64.deb`
- 🐧 Linux (arm64, e.g. Raspberry Pi) — `Snakie-<version>-arm64.AppImage` or
  `snakie_<version>_arm64.deb`

> Windows is x64 only for now (no arm64 build — see "Building installers"
> below for why).

## Features

Everything below ships in **v0.1.0**:

- ✏️ Edit MicroPython code with syntax highlighting and auto-complete
- 🔌 Connect to a MicroPython device over serial
- 📤 Upload code to the connected device
- 🐚 Interactive shell (REPL) for live coding
- ▶️ Run & Stop buttons, with a one-click Clear Shell
- 🗂️ Browse files both locally and on the device (Thonny-style)
- 📁 Create / rename / delete files and folders on the device
- 🧩 Tabbed interface for editing multiple files at once
- 📦 Flash MicroPython firmware to a device
- 🔭 Variables and code-outline panels (collapsible)
- 🌳 Built-in version control (Git, VS Code-style)
- 🤖 Integrated LLM chat pane
- 🔔 Update notifications when a new version is ready

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
| Linux    | arm64 | `-arm64.AppImage` + `_arm64.deb`   | `ubuntu-24.04-arm` |
| Windows  | x64   | `Snakie.Setup.<v>.exe`             | `windows-latest`   |

Notes on arch coverage:

- **macOS** ships two per-arch dmgs (Apple Silicon + Intel) rather than one
  universal binary. Universal merging of the native `serialport` module is more
  fragile, and two per-arch dmgs are smaller. Both build on the arm64
  `macos-latest` runner because `@serialport/bindings-cpp` provides a universal
  (`darwin-x64+arm64`) prebuilt binary, so no per-arch recompilation is needed.
- **Linux arm64** is built on GitHub's native `ubuntu-24.04-arm` hosted runner
  (not via QEMU/emulation). `serialport` ships a `linux-arm64` prebuilt binary,
  and the AppImage/deb packaging tools run on their native arch. If the hosted
  arm64 runner pool is ever unavailable, this job needs a self-hosted arm64
  runner instead — it cannot be reliably produced on the x64 `ubuntu-latest`
  runner.
- **Windows is x64 only.** GitHub's hosted Windows runners are x64 and there is
  no native arm64 Windows runner in the hosted pool, so a reliable arm64 nsis
  installer can't be produced here yet. (`serialport` does ship a `win32-arm64`
  prebuild, so this is a CI-infrastructure limitation, not a code one — revisit
  if/when an arm64 Windows runner becomes available.)

> The app icon in `build/icon.png` is a generated placeholder — TODO: replace
> with real artwork. Code signing is not yet configured (future work).

## Status

🚀 **v0.1.0 released** — the full first build plus the post-v0.1.0 backlog
(autocomplete, firmware flashing, Git, LLM chat, package installer, serial
plotter, in-app help, update notifications) are all implemented. See
[docs/build-plan.md](docs/build-plan.md) for the original plan.

> ⚠️ Released features are build- and type-verified but have **not yet been
> exercised against real MicroPython hardware** — first on-device shakedown is
> the next priority (tracked in the v0.2.0 milestone). The LLM chat needs an
> Anthropic API key; the package installer needs network access.

## License

MIT
