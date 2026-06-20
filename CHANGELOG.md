# Changelog

All notable changes to Snakie are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Board View v2.** The Board View is now its own **floating window** (a real
  always-on-top window fed the active file live over IPC) instead of a modal
  dialog, and it labels each wired pin by **connection type** — `output`, `input`,
  `pwm`, `i2c`, `spi` or `pio` — instead of guessing a peripheral. `Pin` direction
  is read from `Pin.OUT`/`Pin.IN` (and inferred from `.on()`/`.value()` usage when
  undirected). It is now **multi-board**: a selector switches between built-in
  definitions for the Raspberry Pi Pico 2 W, ESP32 DevKit, Pimoroni Pico Plus 2,
  Tiny 2040 and Tiny 2350, drawn from a generic, data-driven renderer.

### Added
- **Custom board definitions.** Drop a `BoardDefinition` JSON file into
  `<userData>/boards/` to add your own board to the Board View (a user board
  overrides a built-in with the same `id`); an in-view button opens that folder.
  See `docs/board.md` for the schema and a worked example.

## [0.8.0] - 2026-06-20

### Added
- **Board View popup.** A new editor pop-up that parses the active Python file for
  pin usage (`Pin`, `PWM`, `I2C`, `SPI`, `StateMachine`) and draws a Raspberry Pi
  Pico 2 W / RP2350 board with colour-coded wires from each used GPIO to a
  representative peripheral (LED, SG90 servo, BME280, WS2812, ST7789), plus a
  "pins in use" table listing the bus, pins, variable and constructor. Opens from a
  **Board** button in the toolbar and re-wires live as you edit.

### Changed
- **Packages panel — manila-tag skin (Skeuomorph).** The package manager is
  reskinned as kraft manila tags on green felt (kraft spine, eyelet, version
  rubber-stamp, INSTALL gold key / INSTALLED green stamp), with a live **flash
  usage** readout + meter sourced from the device's `os.statvfs('/')` when
  connected. Search/install behaviour is unchanged.
- **Plugins panel — module-rack skin (Skeuomorph).** The Plugins view is reskinned
  as a eurorack module rack — brushed faceplates with mounting rails, hex screws,
  per-module accent stripe, knob/LED/patch-jack — where **mounted** modules are
  plugins that loaded OK (click to patch in and run their commands) and
  **available** modules are ones that failed to load (gold **GET** retries the
  load). All plugin actions are preserved.
- **Find & Replace polish (Skeuomorph).** The Find & Replace panel (#92) becomes a
  draggable brushed-aluminium floating dialog with **whole-word** and **regex**
  toggles (invalid patterns are guarded, not thrown) and an **N of M matches**
  counter. All existing find/replace behaviour and shortcuts are unchanged.

## [0.7.0] - 2026-06-20

### Added
- **Find & Replace (#92).** A panel for the editor with a **Find** and a
  **Replace with** box, a **case-sensitive** toggle, an **Up/Down** search
  direction (Down by default), and **Find / Replace / Replace+Find / Replace all**
  buttons (Replace-all is a single undo step). Opens with ⌘/Ctrl-F (find) or
  ⌘/Ctrl-H (replace), plus a toolbar button; Esc closes.
- **YAML / JSON validation (#93).** `.json`, `.yml` and `.yaml` files are
  validated as you edit — invalid formats get squiggles and Problems-panel entries
  with the line/column and reason, plus an **autofix** (format/prettify, and
  best-effort JSON comment + trailing-comma repair) offered as a lightbulb
  quick-fix and a Fix/Format button.

### Changed
- **Dark mode is now a dark Skeuomorph (#91).** Toggling to dark gives a cohesive
  dark version of the default skin — dark brushed-metal chrome, brass knobs,
  glossy dark Run/Stop pills, dark green-felt Source Control, a deep-slate
  ruled-paper editor, the recessed green-phosphor console, and a dark metal status
  bar — instead of the old flat NES dark theme. The ruled-paper settings and the
  light⇄dark toggle are unchanged.

## [0.6.3] - 2026-06-19

### Fixed
- **First signed + notarized macOS release.** Getting macOS signing to actually
  run took fixing three release-workflow problems: `CSC_IDENTITY_AUTO_DISCOVERY=false`
  was a kill-switch that *disabled* signing (so signed builds shipped unsigned);
  the signing env leaked into the Windows job (signing the `.exe` with the macOS
  cert, then failing when scoped to an empty string); and notarization needs the
  Apple Team ID, now set in `electron-builder.yml`. The macOS build is now signed
  (Developer ID Application) **and** notarized, so the in-app updater can install
  on macOS (Squirrel.Mac validates the signature) and Gatekeeper no longer flags
  the app as "damaged". No functional changes since 0.6.0. (0.6.1 and 0.6.2 were
  superseded build attempts.)

## [0.6.0] - 2026-06-19

### Added
- **MicroPython firmware catalog in the flash dialog (#64).** The firmware
  flasher can now pull the UF2 firmware catalog (Thonny's curated MicroPython
  list) in the main process and present a **Family → Model → Variant → Version**
  cascade. **Download & Flash** streams the chosen `.uf2` to a temp file and
  flashes it with a live **% progress bar** and a **Done** button. The local-file
  Browse and the ESP/esptool paths are unchanged.
- **Check for Updates (#89).** A native **Check for Updates…** menu item (in the
  app menu on macOS, a Help menu on Windows/Linux) plus a clickable **status-bar
  version** both run the same manual GitHub update check — prompting to download
  when a newer release exists, reporting "up to date" otherwise, and noting that
  updates only apply to installed builds when run unpackaged.
- **Docstrings in the outline (#88).** Hovering a function or class in the
  outline / function inspector now shows its docstring as a tooltip.

### Changed
- **Simplified the local Files panel (#87).** New File / New Folder are now
  icon-only; Rename and Delete moved into the right-click menu; and the Open
  Folder button is replaced by a clickable **path breadcrumb** where each
  ancestor segment re-roots the tree.

### Fixed
- **Update errors stay contained (#90).** A long update/install error (e.g. the
  macOS code-signature validation failure) now wraps inside its box with a short,
  friendly summary (full text on hover) instead of overflowing the notifier and
  status bar, and offers a **Download manually** button to the GitHub releases
  page. (The signature failure itself still requires a properly signed +
  notarized release — see `docs/macos-signing.md`.)

## [0.5.0] - 2026-06-19

### Added
- **In-app LLM provider system (#77).** The Claude chat is now provider-agnostic:
  a main-process registry adds **OpenAI, Google Gemini, Grok (xAI) and GitHub
  Copilot** alongside Anthropic Claude, surfaced as provider / model / effort
  dropdowns at the bottom of the chat with secure per-provider API-key storage.
  Only Anthropic is verified locally; the others are wired to spec and untested
  without credentials.
- **Send console output to chat (#78).** A **Send to chat** button above the
  console (shown when the chat panel is open) plus an **Attach console (since
  last Run)** composer toggle hand the device's REPL output to the assistant
  without copy-paste.
- **AI-first editor (#82).** The chat always sees the up-to-date active file;
  assistant code blocks gain an **Apply** button that writes straight into the
  editor (undoable); and an opt-in **inline autocomplete** (ghost text) suggests
  as you type via a fast, per-provider completion model configured separately
  from the main chat model.
- **GitHub Copilot sign-in.** The Copilot provider authenticates with a GitHub
  **OAuth device-flow** sign-in (approve a code at github.com/login/device) on an
  account with an active Copilot subscription — Snakie exchanges the resulting
  GitHub token for the short-lived Copilot token its chat endpoint requires
  (cached until expiry). A plain personal access token can't reach that endpoint,
  so sign-in is used instead. Experimental — verifiable only against a real
  Copilot account.
- **Editor paper settings (#80, #81).** A new **Settings** dialog (toolbar gear)
  toggles the notebook **ruled lines**, a subtle squared **dots** grid, or
  **off**, and adjusts the **line spacing** (shown live) — persisted across
  launches.
- **Syntax highlighting + editor themes (#84).** Richer Monaco highlighting
  (keywords, strings, numbers, comments and types in distinct colours), a whiter
  off-white paper so the colours read clearly, and an **editor theme** selector
  (Paper / Bright / Midnight) in the Settings → Editor tab, backed by an
  extensible theme table.
- **Tabbed Settings dialog + Chat settings (#83).** The Settings dialog now has
  **Editor** and **Chat** tabs; the chat's title bar is gone and its per-provider
  API keys, the GitHub Copilot sign-in, and the autocomplete settings moved into
  the **Chat** tab (the chat's ⚙ opens it directly).
- **macOS code signing + notarization** wired into the release workflow (#47).
  When the Apple secrets are set (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — see
  `docs/macos-signing.md`), releases are signed (Developer ID, hardened runtime
  + entitlements) and notarized — which is what lets the **in-app updater
  install on macOS** and removes the "damaged" Gatekeeper warning. Builds stay
  unsigned-but-working when the secrets are absent.

### Changed
- **Skeuomorph skin is the new default look.** A photoreal brushed-metal /
  green-felt / cream **ruled-paper** theme: a segmented New/Open/Save control,
  glossy Run/Stop pills, round panel-collapse knobs, a recessed green-phosphor
  console, and a notebook editor whose text sits on ruled lines (transparent
  Monaco over a ruled gradient, with a red margin rule). The toolbar knob flips
  to a dark "lights out" theme.
- **Removed the redundant panel title bars** for Editor, Source Control, Files,
  Packages, Plugins and Inspect (#79) — the activity bar already names the active
  view (Shell and Chat keep their headers, which carry controls).
- **Activity-bar buttons toggle the left panel (#86).** Clicking a view button
  switches to / expands it; clicking the already-active one collapses the left
  panel (click again to re-expand), matching the familiar editor behaviour.

### Fixed
- **Toolbars no longer clip at narrow widths (#85).** The shell-panel header
  controls (Console/Plotter/Problems, Clear, port + connect/disconnect) and the
  device/local file-tree action buttons now wrap instead of being hidden under
  the chat panel when space is tight.

## [0.3.3] - 2026-06-02

### Fixed
- **macOS auto-update (cont.):** the v0.3.2 mac `.zip` was built but not uploaded
  to the release (the CI artifact glob matched `*.blockmap` but not `*.zip`), so
  `latest-mac.yml` referenced a missing file. Upload `dist/*.zip` too.

## [0.3.2] - 2026-06-02

### Fixed
- **macOS auto-update** failed with "ZIP file not provided" — electron-updater
  on macOS downloads a `.zip`, but the mac target only built a `.dmg`. Added a
  `zip` mac target so `latest-mac.yml` references an updatable artifact. (Note:
  the *install* step still needs a signed app on macOS — see #47.)

## [0.3.1] - 2026-06-02

### Added
- Publish a **Linux arm64 AppImage** (built natively), so Raspberry Pi / arm64
  installs can receive in-app updates (#74). (Patch release.)

## [0.3.0] - 2026-06-02

### Added
- **Update notifications + status-bar update button (#74).** When a newer
  release is available the status bar shows an **Update to vX** button (in the
  version slot) — click to **download**, watch progress, then **Restart to
  update** (electron-updater, `autoDownload` off so it's user-initiated); a
  dismissible banner also offers Download. Adds `window.api.updates.download()`
  and an hourly re-check.
- **Python plugin system (MVP, #61).** Snakie spawns the user's `python3` running
  a host that discovers and loads Python plugins and talks to the app over
  JSON-RPC. Plugins use a stdlib-only `snakie` SDK (`@plugin.command`, `Context`,
  `message`/`edit` helpers); discovery from `~/.snakie/plugins/` (+ bundled
  examples and entry points). New **Plugins** activity-bar view lists plugins and
  runs their commands against the active file; graceful "Python not found" state.
  Ships an example plugin + `docs/writing-plugins.md` (design: `docs/plugin-system.md`).
- **Reactive plugins + editor decorations (#69).** Plugins can register a
  `@plugin.linter` that runs automatically as you type (debounced) and on open,
  drawing **squiggle underlines** (Monaco markers) and offering **lightbulb
  quick-fixes** (a Monaco code-action provider applies the plugin's edit). Adds a
  `lint` RPC / `window.api.plugins.lint`, diagnostics with optional ranged
  `fixes`, and an example linter (flags trailing whitespace + TODOs).
- **Python linter plugin (#65).** A bundled `python_linter` plugin runs **ruff**
  (with autofix quick-fixes) or falls back to **pyflakes**, linting `.py` files
  live via the reactive engine. New **Problems** tab in the shell panel (count
  badge, click-to-jump) backed by a shared diagnostics store, and a persisted
  **Lint on/off** toggle. Graceful when no linter is installed (`pip install ruff`).
- **Toolbar file actions:** New File, Open Folder and Save icon buttons (left of
  Run). Save also works via Ctrl/Cmd-S, with a native **Save As** dialog for
  untitled buffers. The opened folder is now the app's shared working directory,
  so both the toolbar and the Files panel drive it.

### Fixed
- **Source Control now follows the open working folder.** It was always showing
  "Open a folder to manage it with Git" even after a folder was chosen in Files;
  it now points the Git service at the shared `currentFolder` (auto `openRepo` +
  status) and its "Open Folder" buttons drive the same shared action.
- **File operations did nothing in Electron.** New File / New Folder / Rename
  (in both file trees) and the "Upload to board" path used `window.prompt`,
  which Electron's renderer doesn't implement — replaced with an in-app prompt
  modal so they work.
- **Critical: `window.api` preload bridge never loaded in the real Electron
  app** (only the browser preview "worked"), so Open Folder, package search, the
  serial port list and all device features did nothing. Two causes, both fixed:
  the preload was emitted as `index.js` but `package.json` is `"type": "module"`,
  so Electron's `require()` failed with `ERR_REQUIRE_ESM` — now emitted/loaded as
  `index.cjs`; and `sandbox: true` blocked the CommonJS preload from
  `require()`-ing `@electron-toolkit/preload` — now `sandbox: false`
  (`contextIsolation` + `nodeIntegration: false` kept). The renderer fallback
  also now logs a loud error if the bridge is missing inside Electron rather than
  silently masking it.
- **Editor matched the app theme:** the Monaco editor no longer shows a light
  background in dark mode. It reads the app's `data-theme` (via a MutationObserver,
  so it can't desync) and uses a custom dark theme whose background matches the
  NES palette (`#14141f`).
- Removed the duplicated "Device files" heading in the device panel's
  empty state (the section header already names it).

### Changed
- **Retro 8-bit UI overhaul.** New look & feel: NES-inspired dark theme
  (slate + blue/red/green/yellow accents), a single readable **JetBrains Mono**
  font across the whole UI, square corners and chunky pixel buttons — the 8-bit
  feel comes from the palette/buttons/borders, not the font. Dark is the default.
- **Left activity bar + view switching.** A vertical icon strip on the far
  left switches the left sidebar between **Files**, **Source Control**,
  **Packages**, **Inspect** (Outline + Variables in a vertical split), and
  **Help**. Source Control / Packages / Outline / Variables / Help moved out of
  the right pane. The center editor is unchanged.
- **Right pane is now Chat-only**; the toolbar toggle is relabelled
  "Panel" → "Chat". Toolbar Run/Stop/Flash and the shell Clear button are
  sized consistently with the other toolbar buttons.

## [0.2.0] - 2026-06-01

### Added
- Drafted a placeholder Snakie app logo — a snake coiled into an "S" on a green
  squircle (`build/icon.png`, editable source `build/icon.svg`). (#46)
- Build target added: macOS Intel (x64) dmg, alongside the existing macOS
  arm64, Linux x64 and Windows x64 installers. (#49) (Linux arm64 was attempted
  but deferred — see #53 — due to electron-builder's x86 `fpm`/`-m64` issues.)
- Unit tests (vitest) for the pure parsing logic — code outline, device
  variables, and serial-plotter line parsing (39 tests); `npm test` and a CI
  test step. Plus `docs/hardware-test-plan.md`, a manual on-device checklist.
  (toward #45)

### Changed
- Renderer startup payload cut ~88% (~7.4 MB → ~0.9 MB): Monaco is now
  code-split and lazy-loaded only when a file is opened, and the unused JSON
  language service was dropped (`.json` opens as plain text). (#48)

### Fixed
- Renderer no longer blank-screens when the Electron preload bridge
  (`window.api` / `window.electron`) is unavailable — e.g. a browser preview or
  a failed preload. A no-op fallback bridge is installed before render so the UI
  degrades gracefully to a "disconnected / empty" state (with a console
  warning). No effect inside Electron, where the real bridge is present.

## [0.1.0] - 2026-06-01

First public build — a cross-platform (Windows / macOS / Linux) Electron
MicroPython editor.

### Added
- **Editor:** Monaco editor with Python syntax, MicroPython-aware autocomplete,
  tabbed multi-file editing (with a `+` new-tab button), and Ctrl/Cmd-S save.
- **Files:** local and on-device file browsers with right-click context menus;
  create / rename / delete on both; upload-to-board / download-to-computer
  controls between the panes.
- **Device:** serial connection layer speaking the MicroPython raw-REPL
  protocol; interactive xterm REPL with connect / port-select / status; Run,
  Stop and Clear-shell controls; a serial plotter for numeric console output.
- **Right pane (tabbed):** in-app Help & MicroPython reference, code Outline,
  device Variables inspector, Claude LLM chat, and a `mip`/PyPI package
  installer with discovery.
- **Tools:** in-app MicroPython firmware flashing (esptool for ESP, UF2 copy for
  RP2040); built-in Git source control (status / stage / commit / diff /
  branch / push / pull); update notifications via electron-updater.
- **Shell:** resizable, collapsible panels with a light/dark theme.
- **Packaging:** electron-builder installers (Windows NSIS, macOS dmg, Linux
  AppImage + deb) built and published to GitHub Releases by a tag-triggered CI
  workflow.

### Known limitations
- Device, serial, firmware and on-device package-install paths are
  build/type-verified but not yet validated against real hardware.
- The LLM chat requires an Anthropic API key; the package installer requires
  network access.
- Placeholder app icon; code signing not yet configured.

[Unreleased]: https://github.com/kevinmcaleer/Snakie/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/kevinmcaleer/Snakie/compare/v0.6.0...v0.6.3
[0.6.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.3...v0.5.0
[0.3.3]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/kevinmcaleer/Snakie/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kevinmcaleer/Snakie/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kevinmcaleer/Snakie/releases/tag/v0.1.0
