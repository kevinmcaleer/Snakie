# Writing Snakie plugins

Snakie plugins are ordinary **Python** packages. Snakie spawns a Python host
(`python3 -m snakie.host`) that discovers and loads your plugins and talks to
the editor over JSON-RPC; you just write commands against the `snakie` SDK.

For the full design see [`plugin-system.md`](./plugin-system.md).

## Prerequisites

- **Python 3** on your `PATH` (Snakie tries `python3`, then `python`). If it
  can't find one, the **Plugins** view shows an install prompt instead.
- The SDK: `pip install snakie`.

  > Snakie also ships a bundled copy of the SDK plus an example plugin, so the
  > Plugins view works out of the box even before you `pip install` anything.

## Where plugins live

Snakie discovers plugins from **`~/.snakie/plugins/`**:

- a single-file plugin: `~/.snakie/plugins/my_plugin.py`
- a package plugin: `~/.snakie/plugins/my_plugin/__init__.py`

(It also discovers `snakie.plugins` entry points from installed packages, and
loads its own bundled `examples/plugins/`.)

## Scaffold a plugin

Create `~/.snakie/plugins/my_plugin/__init__.py`:

```python
from snakie import plugin, Context, message, edit

@plugin.command("hello", "Say hello")
def hello(ctx: Context):
    # ctx.file has .path, .name, .source ('local' | 'device') and .content
    return message("info", f"Editing {ctx.file.name} ({len(ctx.file.content)} chars)")

@plugin.command("upper", "Uppercase the file")
def upper(ctx: Context):
    return edit(ctx.file.content.upper())
```

A copy of this lives in the repo at
[`examples/plugins/hello/__init__.py`](../examples/plugins/hello/__init__.py) —
use it as a starting point.

## The SDK

Import everything from the top-level `snakie` package:

- **`@plugin.command(id, title)`** — register a command. `id` is unique;
  `title` is shown in the Plugins view.
- **`Context`** — what your command receives:
  - `ctx.file`: `path`, `name`, `source`, `content`
  - `ctx.selection` (optional): `start_line`, `start_column`, `end_line`,
    `end_column`, `text`
- **Return helpers** (return one, or a list of them):
  - `message(level, text)` — `level` is `"info"`, `"warning"` or `"error"`;
    shown as a notice in the panel.
  - `edit(new_content)` — replace the active file's contents (the buffer is
    marked dirty; save as usual).
  - `diagnostic(line, message, *, severity=..., column=..., end_line=...,
    end_column=..., source=..., fixes=...)` — a problem marker (see
    **Linters** below). When returned from a command it shows as a notice;
    when returned from a linter it becomes an editor squiggle.

Returning `None` is fine (the command simply ran with no action). A bare string
is treated as an info message.

## Linters (reactive analysis + quick-fixes)

A **linter** runs automatically as you type and decorates the editor with
squiggles (and optional lightbulb quick-fixes). Register one with
`@plugin.linter(name)`; its handler takes a `Context` and returns a list of
diagnostics:

```python
import re
from snakie import plugin, Context, diagnostic, fix

@plugin.linter("lint-demo")
def lint(ctx: Context):
    out = []
    for i, line in enumerate(ctx.file.content.splitlines()):
        line_no = i + 1                      # diagnostics are 1-based
        stripped = line.rstrip()
        if stripped != line:                 # trailing whitespace
            start = len(stripped) + 1
            end = len(line) + 1
            out.append(diagnostic(
                line_no, "Trailing whitespace",
                severity="warning", column=start, end_column=end,
                source="lint-demo",
                fixes=[fix("Remove trailing whitespace", "",
                           line=line_no, column=start,
                           end_line=line_no, end_column=end)],
            ))
    return out
```

A full copy lives at
[`examples/plugins/lint_demo/__init__.py`](../examples/plugins/lint_demo/__init__.py)
(flags trailing whitespace and `# TODO` comments).

### The diagnostic / fix API

- **`diagnostic(line, message, *, severity="warning", column=None,
  end_line=None, end_column=None, source="snakie", fixes=None)`** — one marker.
  - `severity` is one of `"error"`, `"warning"`, `"info"`, `"hint"`.
  - All line/column coordinates are **1-based**. If `end_column` is omitted the
    editor extends the squiggle to the end of the word (or line).
  - `fixes` is an optional list built with `fix(...)`.
- **`fix(title, new_text, *, line=None, column=None, end_line=None,
  end_column=None)`** — a quick-fix shown on the lightbulb. It replaces the
  given **1-based** range with `new_text`. **Omit the range entirely** to mean
  "replace the diagnostic's own range". Fixes are always ranged — there is no
  whole-file replacement form, so target the exact span you flagged.

A linter may return a single diagnostic, a list, or `None`. Errors raised inside
one linter are isolated (logged to stderr) and never abort the others.

### How reactive linting works

- When the active file's content changes — and on file open / switch — Snakie
  **debounces ~400 ms**, then runs every registered linter via the host's
  `lint` RPC against the current `{file: {path, name, source, content}}`.
  Stale requests are cancelled, so it never lints on every keystroke.
- Returned diagnostics become Monaco **markers** (squiggles, severity-coloured).
  Diagnostics that carry `fixes` are also offered as **lightbulb quick-fixes**;
  applying one edits the buffer in place (which marks it dirty and re-lints).
- If Python isn't found (or the plugin bridge is unavailable) linting is a
  silent no-op — the editor simply shows no plugin squiggles.

## Run a command

1. Open the **Plugins** view from the activity bar (the puzzle-piece icon).
2. Open the file you want to act on — commands run against the **active file**.
3. Press **Run** next to a command. `message` results appear as notices in the
   panel; `edit` results replace the active buffer.

Added a new plugin (or edited one)? Press **Reload** in the Plugins view to
re-spawn the host and pick it up.

## Notes & trust

- Plugins are arbitrary Python executed as you. Only install plugins you trust.
- Your command runs inside the host process; anything you `print` goes to
  Snakie's stderr/log, never the JSON-RPC channel, so it won't corrupt the
  protocol.
- Keep commands quick and side-effect-light; long-running work blocks the host.
