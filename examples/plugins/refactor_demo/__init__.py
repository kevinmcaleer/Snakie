"""Example Snakie plugin: a house-style refactoring provider.

Demonstrates the ``@plugin.refactor`` API (epic #634 §6). Where
``@plugin.linter`` says *this is a problem*, a refactoring provider says *here
is the change, and here is why* — Snakie shows your edit as a diff preview
before it touches anything, exactly as it does for its own built-in rules.

The motivating case is a classroom. A school that wants every robot to log
through one helper — so output can be silenced for a demo, or redirected to a
file — can ship that as a plugin rather than hoping students remember. Two
rules here:

* **print() → log()** — offers to route a bare ``print(...)`` call through the
  house logger, and adds the import when it is missing.
* **Magic pin number** — offers to name a bare integer passed to ``Pin(...)``,
  because ``Pin(GRIPPER_SERVO)`` survives a rewiring and ``Pin(16)`` does not.

Both read ``ctx.selection``, so they only fire on the code the user actually
highlighted before opening **Refactor…**.

Copy this into ``~/.snakie/plugins/`` as a scaffold — see
``docs/writing-plugins.md``.

Note this is desktop-only by nature: it runs in the Python host, which the web
build (#267) does not have. Snakie's core catalogue works everywhere; plugin
rules are additive on top of it.
"""

import re

from snakie import fix, plugin, refactoring

#: The helper a house style routes output through.
LOG_FUNCTION = "log"

#: ``print(<something>)`` occupying the whole selection.
PRINT_CALL = re.compile(r"^print\((.*)\)$", re.DOTALL)

#: ``Pin(<int>)`` / ``machine.Pin(<int>, ...)`` with a bare number first.
PIN_CALL = re.compile(r"^(?:machine\.)?Pin\(\s*(\d+)\s*(,.*)?\)$", re.DOTALL)


def _selected(ctx):
    """The selection's text, or None when nothing useful is highlighted."""
    sel = getattr(ctx, "selection", None)
    if sel is None:
        return None
    text = (sel.text or "").strip()
    return text or None


def _range(ctx):
    """The selection as the 1-based keyword arguments :func:`fix` wants."""
    sel = ctx.selection
    return {
        "line": sel.start_line,
        "column": sel.start_column,
        "end_line": sel.end_line,
        "end_column": sel.end_column,
    }


@plugin.refactor("house-style")
def house_style(ctx):
    """Offer the school's logging helper in place of a bare ``print``."""
    text = _selected(ctx)
    if not text:
        return []
    match = PRINT_CALL.match(text)
    if not match:
        return []
    # Already going through the logger — nothing to offer.
    if match.group(1).lstrip().startswith(LOG_FUNCTION + "("):
        return []

    fixes = [fix(f"Use {LOG_FUNCTION}()", f"{LOG_FUNCTION}({match.group(1)})", **_range(ctx))]
    # Add the import if the file has not got one. Line 1 keeps the edit simple
    # and ranged; a real plugin would place it after the docstring.
    content = ctx.file.content or ""
    if f"import {LOG_FUNCTION}" not in content and f"def {LOG_FUNCTION}" not in content:
        fixes.append(
            fix(
                "Import the logger",
                f"from house import {LOG_FUNCTION}\n",
                line=1,
                column=1,
                end_line=1,
                end_column=1,
            )
        )

    return refactoring(
        f"Use the school {LOG_FUNCTION}() helper",
        f"House style routes output through {LOG_FUNCTION}() so it can be silenced or redirected",
        fixes=fixes,
        help_article="school-logging",
        # Not `safe`: swapping the call changes where output goes, which is a
        # decision the person holding the robot should make deliberately.
        safe=False,
        **_range(ctx),
    )


@plugin.refactor("named-pins")
def named_pins(ctx):
    """Offer to name a bare pin number, so a rewiring is a one-line change."""
    text = _selected(ctx)
    if not text:
        return []
    match = PIN_CALL.match(text)
    if not match:
        return []

    number = match.group(1)
    rest = match.group(2) or ""
    name = f"PIN_{number}"
    replacement = text.replace(number, name, 1)

    return refactoring(
        f"Name pin {number}",
        f"`Pin({number}{rest})` survives nothing; `Pin({name}{rest})` survives a rewiring",
        fixes=[
            fix(f"Use {name}", replacement, **_range(ctx)),
            fix(
                f"Define {name}",
                f"{name} = const({number})\n",
                line=1,
                column=1,
                end_line=1,
                end_column=1,
            ),
        ],
        help_article="refactor-named-constant",
        safe=False,
        **_range(ctx),
    )
