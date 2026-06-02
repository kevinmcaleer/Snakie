# Snakie Plugin System — design (#61)

Snakie is an Electron (Node/TypeScript) app, but it targets **Python**
developers. So plugins are written in **Python** and run in a **Python host
process** that Snakie spawns and talks to over a small JSON-RPC protocol. Plugin
authors `pip install snakie` (the SDK) and write a normal Python package.

## Goals

- Let users extend Snakie in Python (commands, linters, panels, …) without
  touching the Electron codebase.
- Plugins are ordinary, `pip`-installable Python packages depending on the
  `snakie` SDK — discoverable, versionable, shareable.
- Safe-by-default UX: plugins are arbitrary code, so installation is explicit
  and the trust model is clear (see Security). This sets up the future
  community marketplace (tracked separately).

## Architecture

```
┌──────────────── Electron main (Node/TS) ────────────────┐
│  PluginHost  ── spawns ──▶  python3 -m snakie.host       │
│   • finds a Python interpreter (configurable)            │
│   • newline-delimited JSON-RPC over stdin/stdout         │
│   • exposes window.api.plugins to the renderer (IPC)     │
└──────────────────────────────────────────────────────────┘
              ▲ requests (runCommand, lint, …)
              ▼ responses + notifications (showMessage, applyEdit, diagnostics)
┌──────────────── Python host (snakie.host) ──────────────┐
│  • discovers plugins (entry points + ~/.snakie/plugins)  │
│  • imports each, calls its register(app)                 │
│  • dispatches commands/hooks; serialises results         │
└──────────────────────────────────────────────────────────┘
```

- **Why a separate process (not bundled CPython, not Pyodide):** plugins are
  real Python and can use the user's installed packages; matches how the user
  already works with MicroPython tooling. The interpreter is the user's
  `python3` (overridable in settings).
- **Why JSON-RPC over stdio:** simple, dependency-free, language-agnostic, easy
  to debug. Messages are newline-delimited JSON objects.

## Protocol (newline-delimited JSON)

Requests/responses use `{ "id", "method", "params" }` / `{ "id", "result"|"error" }`.
Notifications (no `id`) flow host→app for side effects.

App → host:
- `initialize` → `{ plugins: PluginInfo[] }`
- `listCommands` → `{ commands: CommandInfo[] }`  (`{ id, title, pluginId }`)
- `runCommand(commandId, context)` → `{ actions: Action[] }`
- `lint(context)` → `{ diagnostics: Diagnostic[] }`  (used by the linter plugin)
- `shutdown`

`context` = `{ file: { path, name, source, content }, selection? }`.

Host → app notifications (also returnable as `actions`):
- `showMessage({ level, text })`
- `applyEdit({ content })` — replace active file contents
- `diagnostics({ path, items: Diagnostic[] })`
- `log({ level, text })`

`Diagnostic` = `{ line, column?, endLine?, endColumn?, severity, message, source }`.

## The `snakie` Python SDK (what authors install)

```python
# my_plugin/__init__.py
from snakie import plugin, Context, message, edit

@plugin.command("hello", "Say hello")
def hello(ctx: Context):
    return message("info", f"Editing {ctx.file.name} ({len(ctx.file.content)} chars)")

@plugin.command("upper", "Uppercase the file")
def upper(ctx: Context):
    return edit(ctx.file.content.upper())
```

- `plugin.command(id, title)` — register a command (shown in the Plugins view /
  command list).
- `plugin.linter(name)` — register a linter `(ctx) -> list[Diagnostic]`, run
  reactively by the editor (squiggles + lightbulb quick-fixes, issue #69).
- Helpers: `message(level, text)`, `edit(new_content)`, `diagnostic(...)`,
  `fix(title, new_text, ...)` (a quick-fix attached to a diagnostic).
- A plugin declares itself either via the `snakie.plugins` entry point in its
  `pyproject.toml` **or** by living in `~/.snakie/plugins/`.

## Discovery & lifecycle

1. On app start, `PluginHost` locates `python3` (setting → `PATH` → common
   locations). If absent, the Plugins UI shows a friendly "install Python + run
   `pip install snakie`" state; the rest of the app is unaffected.
2. The host enumerates plugins from the `snakie.plugins` entry-point group and
   from `~/.snakie/plugins/*`. Each is imported and its `register`/decorators
   run; import errors are reported per-plugin, not fatal.
3. The renderer lists plugins + their commands and lets the user run them
   against the active editor file; results (messages/edits/diagnostics) are
   applied. A **Reload plugins** action re-spawns the host.

## Security / trust model

Plugins are arbitrary Python executed as the user — powerful and dangerous.
For the first version: **explicit local install only** (no auto-download),
a clear "plugins run code on your machine" notice, and per-plugin enable/disable.
The community marketplace must add provenance/signing, sandbox options, a review
process and reporting — designed separately (the marketplace issue).

## MVP scope (this issue, #61)

- `PluginHost` (main) + `window.api.plugins` IPC: `list()`, `runCommand(id, ctx)`,
  `reload()`, status; graceful no-Python state.
- `snakie` SDK package (in `python/snakie/`) with `plugin.command`, `Context`,
  `message`/`edit`, and the `snakie.host` runner.
- Discovery from `~/.snakie/plugins/` (+ entry points if available).
- A **Plugins** activity-bar view: list plugins/commands, Run against the active
  file, show messages, apply edits.
- An example plugin + `docs/writing-plugins.md`.

Out of scope here (follow-up issues): the linter feature built on
`plugin.linter`, the community marketplace + administration, signing/sandbox.
