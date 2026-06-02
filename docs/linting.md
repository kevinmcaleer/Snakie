# Python linting (issue #65)

Snakie ships a real Python linter built on the [plugin system](./plugin-system.md)
and the reactive [linter API](./writing-plugins.md#linters-reactive-analysis--quick-fixes).
It runs automatically as you edit a `.py` file, paints squiggles in the editor,
offers quick-fixes via the lightbulb, and lists every finding in the **Problems**
panel.

## The bundled `python_linter` plugin

[`examples/plugins/python_linter/__init__.py`](../examples/plugins/python_linter/__init__.py)
registers `@plugin.linter("python")`. It only lints files whose name ends in
`.py` (everything else returns no diagnostics), and it auto-detects which linter
tool is installed:

| Tool | How it's run | Fixes? |
| --- | --- | --- |
| **ruff** (preferred) | `ruff check --output-format json --stdin-filename <name> -` with the file content on **stdin** | yes — single-edit fixes become lightbulb quick-fixes |
| **pyflakes** (fallback) | content written to a temp file, linted, temp file removed | no |
| neither | returns no diagnostics (the editor stays quiet) | — |

Detection prefers a **PATH console script** (`ruff` / `pyflakes`); if that is not
found it falls back to `python -m <tool>` (so a tool installed only into the
current interpreter still works). ruff is always tried before pyflakes.
Choosing the tool explicitly is a deliberate follow-up — for now it is
auto-detected.

### ruff diagnostics

Each item in ruff's JSON array becomes a diagnostic:

- `message` is `"<code>: <message>"` (e.g. `F401: \`os\` imported but unused`).
- The range comes from ruff's `location` / `end_location` (1-based row/column).
- Severity is `error` for codes starting `E9` (syntax) or `F` (pyflakes-class),
  otherwise `warning`. `source` is `ruff`.
- If the item carries a `fix` with a single edit, a ranged quick-fix is built
  from that edit's `content` + `location`/`end_location`; the title comes from
  the fix message (or the code).

### pyflakes diagnostics

pyflakes writes `path:line:col: message` (or `path:line: message`) per finding.
The temp path is stripped back out, leaving the human-readable message;
`severity` is `warning`, `source` is `pyflakes`, no fixes.

The parsing lives in pure, importable functions — `parse_ruff_json(stdout)` and
`parse_pyflakes_output(stdout, filename)` — unit-tested with canned input in
[`python/tests/test_python_linter.py`](../python/tests/test_python_linter.py).
Run them (no tool needed) with:

```sh
PYTHONPATH=python python3 -m unittest discover -s python/tests
```

The plugin is robust by design: subprocess calls are timeout-capped, never raise
out of the linter, and empty/whitespace-only content returns nothing.

## The Problems panel

The bottom **Shell** region has a `Console | Plotter | Problems` toggle. The
Problems tab shows a count badge (e.g. `Problems (3)`) and lists the active
file's diagnostics — severity icon, `line:col`, message, and source. Clicking a
row jumps the editor to that line.

When there are no diagnostics it shows **No problems**; if no linter tool is
installed it adds a subtle hint to install ruff (`pip install ruff`).

Architecture: the editor publishes the active file's diagnostics into a shared
store ([`src/renderer/src/store/diagnostics.ts`](../src/renderer/src/store/diagnostics.ts),
via `<DiagnosticsProvider>` / `useDiagnostics()`) after each lint; the Problems
panel reads from it. The Monaco markers and lightbulb quick-fixes are unchanged.

## Turning linting on/off

A checkbox in the Problems panel header toggles linting. The state is persisted
in `localStorage` under `snakie.lintingEnabled` (default **on**). When off, the
editor's lint effect no-ops and clears any existing markers and Problems rows.

## Installing ruff

```sh
pip install ruff
```

Restart Snakie (or reload plugins from the Plugins view) if you install a tool
while it is running.
