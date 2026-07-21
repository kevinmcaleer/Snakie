# CLAUDE.md — working in the Snakie repo

Snakie is a cross-platform **Electron MicroPython editor** (electron-vite + React +
TypeScript, Monaco editor, `serialport` raw-REPL device layer, electron-builder
packaging, and a Python plugin system).

## Commands

```bash
npm run dev        # launch the Electron app (needs a display)
npm run build      # bundle main/preload/renderer into out/
npm run lint       # eslint
npm run typecheck  # tsc (node + web)
npm test           # vitest unit tests
npm run dist       # build installers (electron-builder)
# Python plugin tests:
PYTHONPATH=python python3 -m unittest discover -s python/tests
```

Always keep `lint`, `typecheck`, `test`, and `build` green before merging.

## Layout

- `src/main/**` — Electron main (window, IPC, device/fs/git/plugins/updater layers).
- `src/preload/**` — the `contextBridge` exposing `window.api`. **Built as
  `index.cjs`** (package.json is `"type": "module"`, so a `.js` preload fails with
  `ERR_REQUIRE_ESM`), and `sandbox: false` (the preload `require()`s node modules).
  Don't change those without re-verifying the bridge loads in real Electron.
- `src/renderer/src/**` — React UI (activity bar + left views, editor, shell,
  status bar, plugins panel). IPC handlers return a serializable `IpcResult<T>`
  that the preload unwraps.
- `python/` — the `snakie` Python SDK + plugin host. `examples/plugins/` — bundled
  example/default plugins. Design: `docs/plugin-system.md`, `docs/writing-plugins.md`.

## Versioning & releases (SemVer, pre-1.0)

Bump the version in `package.json` according to what a release contains:

- **New feature → MINOR bump** (`0.MINOR.0`). e.g. adding a panel, a plugin
  capability, a new command/view.
- **Change / fix / docs / refactor → PATCH bump** (`0.0.PATCH`). e.g. bug fixes,
  tweaks, dependency bumps, copy/UX changes with no new feature.
- (Breaking changes would be a MAJOR bump once we reach `1.0.0`.)

When a release groups several PRs, pick the **highest** applicable bump (any new
feature in the batch ⇒ minor).

**Cutting a release:**
1. Move everything from `CHANGELOG.md` `[Unreleased]` into a new dated
   `[X.Y.Z]` section (Keep a Changelog format); add a fresh empty `[Unreleased]`
   and update the compare links at the bottom.
2. Set `package.json` version to `X.Y.Z` (`npm version X.Y.Z --no-git-tag-version`).
3. Commit, push `master`.
4. Tag and push: `git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z`. The
   `release.yml` workflow builds installers (macOS arm64+x64, Linux x64, Windows
   x64; the tag drives the installer version) and creates a **draft** GitHub
   Release; review and publish it.

The in-app updater (electron-updater) reads published GitHub Releases, so the
update notification (#74) only fires for **packaged** builds against a newer
published release.

## Conventions

- Match surrounding code style; co-locate component CSS and import it; theme via
  the CSS custom-property tokens (both the `skeuomorph`/`dark` skins).
- **Design direction: "Soft Shell"** (epic #573) — warm skeuomorphic parchment,
  green primary + amber/gold accent, tactile instrument controls. New/restyled UI
  should use the Soft Shell tokens (`--panel`/`--shell`/`--card`/`--editor`/`--kw`…,
  defined in `index.css`; spec in `design_handoff_snakie_soft_shell/`) and the
  Soft Shell fonts — **`--font-mono` = IBM Plex Mono**, **`--font-ui` = Plus Jakarta
  Sans** (bundled via @fontsource; the old JetBrains Mono / retro-NES direction is
  superseded).
- `window.prompt` does NOT work in Electron's renderer — use the in-app
  `usePrompt()` modal. `window.confirm` is fine.
- Process management on the dev box: `pkill -f`/`pgrep -f` self-match their own
  command line — manage by port (`lsof -ti:PORT`) or the `[e]lectron` bracket trick.
