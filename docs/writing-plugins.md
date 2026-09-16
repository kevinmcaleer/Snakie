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

Snakie ships a real Python linter built on this API (ruff / pyflakes) plus a
**Problems** panel — see [`docs/linting.md`](./linting.md).

## Refactorings (right-click → Refactor…)

Where a linter says *this is a problem*, a **refactoring provider** says *here
is the change, and here is why*. Register one with `@plugin.refactor(name)`:

```python
from snakie import plugin, refactoring, fix

@plugin.refactor("house-style")
def house_style(ctx):
    sel = ctx.selection
    if not sel or not sel.text.startswith("print("):
        return []
    return refactoring(
        "Use the school logger",
        "House style routes output through log() so it can be silenced",
        fixes=[fix("Use log()", "log(" + sel.text[6:],
                   line=sel.start_line, column=sel.start_column,
                   end_line=sel.end_line, end_column=sel.end_column)],
        help_article="school-logging",
        safe=False,
    )
```

- The handler runs when the user opens **Refactor…**, and gets the same
  `Context` a command does — `ctx.selection` is what they highlighted, so you
  can offer something for *that* code rather than the whole file.
- Build each offer with **`refactoring(title, message, *, fixes, line=...,
  column=..., end_line=..., end_column=..., help_article=..., safe=False)`**.
  `fixes` are ranged edits built with the same `fix()` a linter uses, so both
  paths land in one editor experience.
- **Nothing is applied silently.** Snakie previews your edits as a diff, with a
  **Why?** link to `help_article`, exactly as it does for its own rules. Set
  `help_article` — an offer that explains itself teaches; one that does not is
  just a surprise.
- Leave `safe=False` unless the rewrite is provably behaviour-preserving.
  Snakie shows a caution for anything that is not, and only `safe` offers are
  eligible for bulk **Tidy this file**.
- Return a single offer, a list, or `None`. A provider that raises is reported
  to stderr and skipped — a broken plugin cannot take the whole menu down.

A worked example lives in
[`examples/plugins/refactor_demo/`](../examples/plugins/refactor_demo/): a
classroom house style that routes `print()` through a logger and names bare pin
numbers.

This is **desktop-only** by nature — it runs in the Python host, which the web
build has no equivalent of. Snakie's own catalogue of ~50 refactorings is pure
TypeScript and works everywhere, with or without Python; plugin rules are
additive on top of it.

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

---

## Ship blocks with your plugin (#1017)

A plugin can add blocks to the **Blocks** workspace's palette. They appear under
**Plugins**, in a drawer named after the provider, and they generate real
MicroPython through the same generator every other block uses.

```python
from snakie import plugin, block

ROBOT = "clubbot"

@plugin.blocks("Club robot")
def club_robot_blocks():
    return [
        block(
            "forward",
            "drive forward %1 cm",
            f"{ROBOT}.forward({{CM}})\n",
            args=[{"name": "CM", "kind": "number", "default": 20}],
            imports=[{"module": ROBOT}],
            tooltip="Drive the club robot forward.",
        )
    ]
```

A worked example, covering every argument form, lives in
[`examples/plugins/blocks_demo/`](../examples/plugins/blocks_demo/).

**You are describing a block, not running one.** `code` is a template; filling
it can only produce a string. Your provider is asked for its blocks once, when
the toolbox is built — it does not run while a learner drags, and it cannot
reach the device. Return a single block, a list, or `None`; a provider that
raises is reported to stderr and skipped, so one broken plugin cannot empty the
palette for the others.

This is **desktop-only**, like refactorings: it needs the Python host, which the
web build has no equivalent of. Blocks that belong to a piece of *hardware*
should ship with the part instead — that works everywhere.

### Blocks that ship with a part

Drop a **`blocks.yml`** beside a part's `parts.yml` and its blocks appear
whenever that part is on the breadboard, in a drawer of its own under
**My parts**. Nothing in Snakie has to change to add one.

```yaml
version: 1
blocks:
  - id: sensor
    message: BME280 on I²C %1 with SDA %2 and SCL %3
    shape: value
    output: Object
    args:
      - { name: BUS, kind: number-field, default: 0 }
      - { name: SDA, kind: pin, capability: i2c, default: 0 }
      - { name: SCL, kind: pin, capability: i2c, default: 1 }
    setup:
      key: "bme280:{BUS}:{SDA}:{SCL}"
      name: bme
      expr: "BME280(I2C({BUS}, sda=Pin({SDA}), scl=Pin({SCL})))"
    code: "{SETUP}"
    imports:
      - { module: bme280, name: BME280 }
      - { module: machine, name: I2C }
      - { module: machine, name: Pin }
  - id: temperature
    message: temperature °C from %1
    shape: value
    output: Number
    args:
      - { name: SENSOR, kind: any, shadow: sensor }
    code: "{SENSOR}.temperature()"
```

The shipped example is
[`examples/parts/snakie-standard/bme280/blocks.yml`](../examples/parts/snakie-standard/bme280/blocks.yml).

**A part that ships no `blocks.yml` still gets blocks.** If it declares a
`library.module` (or a copied driver file), Snakie derives three: the object
itself, a way to call a command on it, and a way to read a value from it. The
class name is a guess — the conventional upper-cased module name — so it is put
in an editable field **on the face of the block**, where it can be seen and
corrected rather than failing quietly on the board. Ship a `blocks.yml` and you
replace the guesswork with the real thing.

### The manifest, field by field

Both routes use the same schema and the same validator.

| Field | Meaning |
| --- | --- |
| `id` | Unique within the file. Namespaced per part/plugin, so two may share one. |
| `message` | The Blockly label: `move %1 steps`, with `%1…%n` in argument order. |
| `args` | The arguments, in `%n` order (see below). |
| `shape` | `statement` (stacks, the default) or `value` (plugs into a socket). |
| `output` | `value` only — `Number`, `String`, `Boolean`, or your own name. |
| `code` | The Python, with `{NAME}` holes. |
| `setup` | A hoisted construction; `{SETUP}` in `code` is its variable name. |
| `imports` | `{module, name?, alias?}`, or a bare module name. |
| `tooltip` | Shown on hover. Write it for the learner, not the maintainer. |
| `help` | An **in-app** help article id (`ref-pins`), not a URL — classrooms are often offline. |
| `colour` | A `#rrggbb` override. Omit it and the block wears its category's colour. |
| `inline` | `false` stacks the arguments vertically. Defaults to inline. |

**Argument kinds.** The first group are *sockets* — a hole another block plugs
into, so the value can be computed. The rest are *fields*, chosen or typed on
the block itself.

| `kind` | What it is | What `{NAME}` becomes |
| --- | --- | --- |
| `number` | numeric socket | the plugged expression, else `default` |
| `text` | text socket | the expression, else `default` quoted |
| `boolean` | true/false socket | the expression, else `True`/`False` |
| `any` | untyped socket | the expression, else `default` (use `""` for "no argument") |
| `statements` | a C-shaped body | the body, already indented (`pass` when empty) |
| `number-field` | a number on the block | the number |
| `text-field` | a text box on the block | the text, quoted |
| `choice` | a dropdown (`options`) | the option's value, **verbatim** |
| `toggle` | a checkbox | `True` / `False` |
| `pin` | a pin dropdown (`capability`) | the GPIO number |

Two conveniences worth knowing:

- **`shadow`** on a socket pre-fills it with *another block from the same file*,
  named by its id. That is how the BME280's reading blocks arrive with the
  sensor already plugged in — the first drag produces a working program rather
  than a shape with a hole in it.
- **The circuit fills in the pins.** A `pin` argument named after a bus role
  (`SDA`, `SCL`, `SCK`, `MOSI`, `MISO`, `CS`, `TX`, `RX`) — or `PIN`/`SIGNAL`
  for a one-wire part — gets its default from what the part is *actually wired
  to* in Electronics. A numeric argument called `BUS` gets the I²C/SPI
  controller number the same way. Your `default` is the fallback for a part that
  is in the library but not yet on the breadboard, and a learner who picks a
  different pin keeps it.

**A choice's value is written into the Python exactly as you typed it**, so
`Pin.OUT` and `0x76` work; a choice that means a string carries its own quotes
(`"'fast'"`).

**Templates:** `{{` and `}}` are literal braces, which you need for an f-string
or a dict.

### When a block is turned away

Nothing is dropped in silence (epic #856). A block is refused, by name, when:

- its template names an argument it hasn't got;
- its message has no `%n` for an argument (the field would be invisible, and its
  value silently baked into the learner's program);
- its message uses a `%n` it has no argument for;
- it has no `id`, `message` or `code`, or a `choice` with no `options`;
- a second block reuses an id.

Unknown fields are kept out of the way and reported, so a typo costs you a
warning rather than a block that mysteriously does nothing. A `version:` newer
than this Snakie understands loads anyway, with a note.

### What a manifest cannot do

It cannot run code — a template only ever produces a string. It cannot reach the
device, the file system or the network, and it cannot name a Blockly field type
Snakie didn't build. The strongest thing a hostile `blocks.yml` can do is write
silly Python into a file its own user can read before pressing **Run**.
