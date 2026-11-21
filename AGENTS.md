# AGENTS.md — working in the Snakie repo

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

**The PATCH number bumps itself.** Every pull request merged into `master` gets
its own patch bump (`0.92.0` → `0.92.1` → `0.92.2` …) from
`.github/workflows/version-bump.yml`, committed straight to `master` by
`github-actions[bot]`. **Don't touch `version` in `package.json` /
`package-lock.json` in a feature branch** for an ordinary change: the bot does
it after the merge, so open PRs never conflict on that line.

- **New feature → MINOR bump** (`0.MINOR.0`) is still a human call. Either set it
  in the PR (`npm version 0.93.0 --no-git-tag-version`) or in the release commit.
  A push that already changed the version is left alone, so the next merged PR
  after it becomes `0.93.1`.
- (Breaking changes would be a MAJOR bump once we reach `1.0.0`.)
- Direct pushes to `master` that aren't a PR merge don't bump.

**Cutting a release:**
1. Move everything from `CHANGELOG.md` `[Unreleased]` into a new dated
   `[X.Y.Z]` section (Keep a Changelog format); add a fresh empty `[Unreleased]`
   and update the compare links at the bottom.
2. `master` is already at the latest patch number, so a patch release just
   uses that (`X.Y.Z` = the current `package.json` version). For a minor
   release, set it: `npm version X.Y.0 --no-git-tag-version`.
3. Commit, push `master`.
4. Tag and push: `git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z`. The
   `release.yml` workflow builds installers (macOS arm64+x64, Linux x64, Windows
   x64; the tag drives the installer version) and creates a **draft** GitHub
   Release; review and publish it.

The in-app updater (electron-updater) reads published GitHub Releases, so the
update notification (#74) only fires for **packaged** builds against a newer
published release.

## Conventions

- Match surrounding code style; co-locate component CSS and import it; keep the
  retro NES theme tokens + JetBrains Mono font.
- `window.prompt` does NOT work in Electron's renderer — use the in-app
  `usePrompt()` modal. `window.confirm` is fine.
- Process management on the dev box: `pkill -f`/`pgrep -f` self-match their own
  command line — manage by port (`lsof -ti:PORT`) or the `[e]lectron` bracket trick.
