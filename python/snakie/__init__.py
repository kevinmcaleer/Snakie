"""Snakie plugin SDK.

This is the public API that plugin authors import. It is intentionally
dependency-free (standard library only) so that ``pip install snakie`` pulls in
nothing else and so the bundled copy Snakie ships works on any Python 3.

A plugin is an ordinary Python module/package that imports this SDK and
registers commands against the shared :data:`plugin` registry::

    from snakie import plugin, Context, message, edit

    @plugin.command("hello", "Say hello")
    def hello(ctx: Context):
        return message("info", f"Editing {ctx.file.name}")

    @plugin.command("upper", "Uppercase the file")
    def upper(ctx: Context):
        return edit(ctx.file.content.upper())

Command handlers receive a :class:`Context` describing the active editor file
and (optionally) the current selection, and return one of the *action* helpers
below (or a list of them): :func:`message`, :func:`edit`, :func:`diagnostic`,
:func:`status`.
The Snakie host serialises those actions back to the Electron app over
JSON-RPC; the app shows messages, applies edits and renders diagnostics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

__all__ = [
    "plugin",
    "Plugin",
    "Context",
    "FileContext",
    "Selection",
    "Command",
    "Linter",
    "Refactoring",
    "BlockProvider",
    "message",
    "edit",
    "diagnostic",
    "status",
    "fix",
    "refactoring",
    "block",
]

__version__ = "0.1.0"


# ---------------------------------------------------------------------------
# Context passed to command handlers
# ---------------------------------------------------------------------------


@dataclass
class Selection:
    """A text selection in the active editor (1-based line/column)."""

    start_line: int
    start_column: int
    end_line: int
    end_column: int
    text: str = ""

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "Optional[Selection]":
        if not data:
            return None
        return cls(
            start_line=int(data.get("startLine", 1)),
            start_column=int(data.get("startColumn", 1)),
            end_line=int(data.get("endLine", 1)),
            end_column=int(data.get("endColumn", 1)),
            text=str(data.get("text", "")),
        )


@dataclass
class FileContext:
    """The active editor file a command runs against."""

    path: str
    name: str
    source: str  # 'local' | 'device'
    content: str

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "FileContext":
        data = data or {}
        return cls(
            path=str(data.get("path", "")),
            name=str(data.get("name", "")),
            source=str(data.get("source", "local")),
            content=str(data.get("content", "")),
        )


@dataclass
class Context:
    """Everything a command knows about the current editor state."""

    file: FileContext
    selection: Optional[Selection] = None

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "Context":
        data = data or {}
        return cls(
            file=FileContext.from_dict(data.get("file")),
            selection=Selection.from_dict(data.get("selection")),
        )


# ---------------------------------------------------------------------------
# Action helpers (what a command returns)
# ---------------------------------------------------------------------------

Action = Dict[str, Any]


def message(level: str, text: str) -> Action:
    """Show a message in the Plugins panel.

    ``level`` is one of ``info``, ``warning`` or ``error``.
    """
    return {"type": "message", "level": level, "text": text}


def edit(new_content: str) -> Action:
    """Replace the active file's full contents with ``new_content``."""
    return {"type": "edit", "content": new_content}


def status(
    text: str,
    *,
    tooltip: Optional[str] = None,
    href: Optional[str] = None,
    priority: int = 0,
) -> Action:
    """Show a message in Snakie's **status bar** (the thin bar at the bottom).

    Unlike :func:`message` (which posts to the Plugins panel), a status message
    lives persistently in the status bar's left group. When several plugins post
    a status the one with the highest ``priority`` wins.

    ``tooltip`` sets the hover title. When ``href`` is given the message becomes
    a clickable link that opens externally in the user's browser.

    Returned as an *action* (``{"type": "status", ...}``) so it can be returned
    from a regular ``@plugin.command`` (or a linter — the host accepts it there
    too).
    """
    action: Action = {"type": "status", "text": str(text), "priority": int(priority)}
    if tooltip is not None:
        action["tooltip"] = str(tooltip)
    if href is not None:
        action["href"] = str(href)
    return action


def fix(
    title: str,
    new_text: str,
    *,
    line: Optional[int] = None,
    column: Optional[int] = None,
    end_line: Optional[int] = None,
    end_column: Optional[int] = None,
) -> Dict[str, Any]:
    """Build a quick-fix attached to a diagnostic.

    A fix is ``{ title, edit: { line?, column?, endLine?, endColumn?, newText } }``.
    When the range is omitted entirely the host/editor replaces *the diagnostic's
    own range*. Fixes are always ranged — a ``newText``-only fix that would
    replace the whole file is intentionally not supported (linters should target
    the exact span they flag).

    ``line``/``column``/``end_line``/``end_column`` are 1-based, matching the
    diagnostic coordinate system.
    """
    edit_obj: Dict[str, Any] = {"newText": str(new_text)}
    if line is not None:
        edit_obj["line"] = int(line)
    if column is not None:
        edit_obj["column"] = int(column)
    if end_line is not None:
        edit_obj["endLine"] = int(end_line)
    if end_column is not None:
        edit_obj["endColumn"] = int(end_column)
    return {"title": str(title), "edit": edit_obj}


def diagnostic(
    line: int,
    message: str,
    *,
    severity: str = "warning",
    column: Optional[int] = None,
    end_line: Optional[int] = None,
    end_column: Optional[int] = None,
    source: str = "snakie",
    fixes: Optional[List[Dict[str, Any]]] = None,
) -> Action:
    """Produce a single diagnostic action (problem marker / squiggle).

    ``severity`` is one of ``error``, ``warning``, ``info``, ``hint``. All
    line/column coordinates are 1-based. ``fixes`` is an optional list of
    quick-fixes built with :func:`fix`, surfaced as editor lightbulb actions.

    The returned value is an *action* (``{"type": "diagnostic", "item": {...}}``)
    so it can be returned from a regular ``@plugin.command``. Linters
    (``@plugin.linter``) may return the action form or the bare ``item`` dict —
    the host normalises both.
    """
    item: Dict[str, Any] = {
        "line": int(line),
        "severity": severity,
        "message": str(message),
        "source": source,
    }
    if column is not None:
        item["column"] = int(column)
    if end_line is not None:
        item["endLine"] = int(end_line)
    if end_column is not None:
        item["endColumn"] = int(end_column)
    if fixes:
        item["fixes"] = list(fixes)
    return {"type": "diagnostic", "item": item}


def refactoring(
    title: str,
    message: str,
    *,
    fixes: List[Dict[str, Any]],
    line: Optional[int] = None,
    column: Optional[int] = None,
    end_line: Optional[int] = None,
    end_column: Optional[int] = None,
    help_article: Optional[str] = None,
    safe: bool = False,
) -> Dict[str, Any]:
    """Build one refactoring offer (epic #634 §6), returned by ``@plugin.refactor``.

    ``title`` is the menu label the user picks; ``message`` is the one-line
    explanation shown above the diff. ``fixes`` are ranged edits built with
    :func:`fix` — the same shape a linter's quick-fixes use, so both paths
    normalise into one editor experience.

    The line/column range (1-based) is what the offer *covers*; omit it and the
    selection is used. ``help_article`` names a page for the preview's **Why?**
    link, which is worth setting — an offer that explains itself teaches, and
    one that does not is just a surprise.

    ``safe`` says the rewrite is provably behaviour-preserving. Leave it False
    unless you are certain: Snakie shows a caution in the preview for anything
    that is not, and only ``safe`` offers are eligible for bulk "Tidy this file".
    """
    item: Dict[str, Any] = {
        "title": str(title),
        "message": str(message),
        "fixes": list(fixes),
        "safe": bool(safe),
    }
    if line is not None:
        item["line"] = int(line)
    if column is not None:
        item["column"] = int(column)
    if end_line is not None:
        item["endLine"] = int(end_line)
    if end_column is not None:
        item["endColumn"] = int(end_column)
    if help_article is not None:
        item["helpArticle"] = str(help_article)
    return item


def block(
    id: str,
    message: str,
    code: str,
    *,
    args: Optional[List[Dict[str, Any]]] = None,
    shape: str = "statement",
    output: Optional[str] = None,
    setup: Optional[Dict[str, Any]] = None,
    imports: Optional[List[Any]] = None,
    tooltip: Optional[str] = None,
    help: Optional[str] = None,
    colour: Optional[str] = None,
    inline: Optional[bool] = None,
) -> Dict[str, Any]:
    """Build one block for ``@plugin.blocks`` (#1017, epic #1007).

    This is the same manifest a part ships as ``blocks.yml`` — the schema is
    documented once, in ``docs/writing-plugins.md``, and a plugin returning these
    dicts and a part shipping that YAML go through exactly the same validator on
    the Snakie side.

    ``message`` is a Blockly message string: ``"flash %1 times"``, with ``%1``
    through ``%n`` in argument order. ``code`` is a Python TEMPLATE, with
    ``{NAME}`` holes naming the arguments (and ``{SETUP}`` for a hoisted object
    declared via ``setup``). A template can only ever produce a string — your
    plugin does not run on the learner's canvas, its blocks do::

        from snakie import plugin, block

        @plugin.blocks("classroom")
        def classroom_blocks(_ctx=None):
            return [
                block(
                    "cheer",
                    "cheer %1 times",
                    'for _ in range({TIMES}):\n    print("well done!")\n',
                    args=[{"name": "TIMES", "kind": "number", "default": 3}],
                    tooltip="Print some encouragement.",
                )
            ]

    Every field is optional except the three positional ones. Anything Snakie
    does not understand is reported back to you as a warning rather than being
    quietly dropped, so a typo in a key name is findable.
    """
    item: Dict[str, Any] = {"id": str(id), "message": str(message), "code": str(code)}
    if args:
        item["args"] = list(args)
    item["shape"] = "value" if shape == "value" else "statement"
    if output is not None:
        item["output"] = str(output)
    if setup is not None:
        item["setup"] = dict(setup) if isinstance(setup, dict) else {"expr": str(setup)}
    if imports:
        item["imports"] = list(imports)
    if tooltip is not None:
        item["tooltip"] = str(tooltip)
    if help is not None:
        item["help"] = str(help)
    if colour is not None:
        item["colour"] = str(colour)
    if inline is not None:
        item["inline"] = bool(inline)
    return item


# ---------------------------------------------------------------------------
# The plugin registry
# ---------------------------------------------------------------------------


@dataclass
class Command:
    """A registered command."""

    id: str
    title: str
    handler: Callable[[Context], Any]
    plugin_id: str = ""


@dataclass
class Linter:
    """A registered linter.

    ``handler`` is ``(ctx: Context) -> list[Diagnostic]`` (or a single
    diagnostic / the :func:`diagnostic` action form — the host normalises the
    return value). It is run reactively by the editor whenever the active file's
    content changes.
    """

    name: str
    handler: Callable[[Context], Any]
    plugin_id: str = ""


@dataclass
class Refactoring:
    """A registered refactoring provider (epic #634 §6).

    ``handler`` is ``(ctx: Context) -> list[Refactoring offer]``, run when the
    user opens **Refactor…** on a selection. ``ctx.selection`` carries what they
    highlighted, so a provider can offer something for *this* code rather than
    the whole file.

    Each offer is built with :func:`refactoring` and carries ranged
    :func:`fix`-shaped edits. Snakie shows the same diff preview it shows for
    its own rules before anything touches the file, so a plugin cannot rewrite
    a user's code behind their back.
    """

    name: str
    handler: Callable[[Context], Any]
    plugin_id: str = ""


@dataclass
class BlockProvider:
    """A registered source of palette blocks (#1017, epic #1007).

    ``handler`` takes no arguments (an optional context is passed for symmetry
    with the other handlers and may be ignored) and returns a list of block
    dicts built with :func:`block`. It is called when the Blocks workspace builds
    its toolbox, so it should be cheap and must not touch the device.

    Desktop-only by nature, like refactorings: it needs the Python host, which
    the web build (#267) does not have. Parts ship their blocks as a
    ``blocks.yml`` instead, which works everywhere.
    """

    name: str
    handler: Callable[..., Any]
    plugin_id: str = ""


class Plugin:
    """The shared registry that ``@plugin.command`` writes to.

    A single module-level instance (:data:`plugin`) is shared across every
    imported plugin. The host tags each command with the plugin module it was
    imported from so the UI can group commands by plugin.
    """

    def __init__(self) -> None:
        self.commands: List[Command] = []
        self.linters: List[Linter] = []
        self.refactorings: List[Refactoring] = []
        self.block_providers: List[BlockProvider] = []
        # The plugin id the host is currently importing; commands registered
        # while this is set are attributed to it. Set by the host around each
        # import (see snakie.host).
        self._current_plugin_id: str = ""

    def command(self, id: str, title: str) -> Callable[[Callable[[Context], Any]], Callable[[Context], Any]]:
        """Decorator: register ``func`` as the command ``id`` titled ``title``."""

        def decorator(func: Callable[[Context], Any]) -> Callable[[Context], Any]:
            self.commands.append(
                Command(id=id, title=title, handler=func, plugin_id=self._current_plugin_id)
            )
            return func

        return decorator

    def linter(self, name: str) -> Callable[[Callable[[Context], Any]], Callable[[Context], Any]]:
        """Decorator: register ``func`` as a linter named ``name``.

        The handler is ``(ctx: Context) -> list[Diagnostic]`` and is run
        reactively by the editor as the active file changes. Each diagnostic may
        carry quick-fixes (see :func:`diagnostic` / :func:`fix`). Returning a
        single diagnostic, a list, or ``None`` are all accepted.
        """

        def decorator(func: Callable[[Context], Any]) -> Callable[[Context], Any]:
            self.linters.append(
                Linter(name=name, handler=func, plugin_id=self._current_plugin_id)
            )
            return func

        return decorator

    def refactor(self, name: str) -> Callable[[Callable[[Context], Any]], Callable[[Context], Any]]:
        """Decorator: register ``func`` as a refactoring provider (epic #634 §6).

        The handler is ``(ctx: Context) -> list[offer]`` and runs when the user
        opens **Refactor…**. ``ctx.selection`` is the highlighted range (1-based
        line/column, with the selected ``text``), so a provider can offer
        something specific to what was picked.

        Build each offer with :func:`refactoring`. Returning a single offer, a
        list, or ``None`` are all accepted::

            from snakie import plugin, refactoring, fix

            @plugin.refactor("house-style")
            def house_style(ctx):
                sel = ctx.selection
                if not sel or not sel.get("text", "").startswith("print("):
                    return []
                return refactoring(
                    "Use the school logger",
                    "Our house style routes output through log() so it can be turned off",
                    fixes=[fix("Use log()", "log(" + sel["text"][6:],
                               line=sel["startLine"], column=sel["startColumn"],
                               end_line=sel["endLine"], end_column=sel["endColumn"])],
                )

        A school can ship its own house-style refactorings this way, and the
        robot-specific rules can live in a plugin rather than the core. Note
        this is desktop-only by nature: it needs the Python host, which the web
        build (#267) does not have — the core catalogue works everywhere, and
        plugin rules are additive on top.
        """

        def decorator(func: Callable[[Context], Any]) -> Callable[[Context], Any]:
            self.refactorings.append(
                Refactoring(name=name, handler=func, plugin_id=self._current_plugin_id)
            )
            return func

        return decorator

    def blocks(self, name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator: register ``func`` as a source of palette blocks (#1017).

        The handler returns a list of blocks built with :func:`block`; they
        appear in the Blocks workspace's **Plugins** category, in a drawer named
        after your plugin. Returning a single block, a list, or ``None`` are all
        accepted.

        This is the second of the epic's three answers to "what about a library
        Blockly has never seen?": a part can ship blocks as data, a plugin can
        return them over this host, and the escape hatches cover whatever is
        left. Extending the palette never means editing Snakie::

            from snakie import plugin, block

            @plugin.blocks("my-robot")
            def my_robot_blocks(_ctx=None):
                return [block("beep", "beep", "buzzer.beep()\n")]
        """

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            self.block_providers.append(
                BlockProvider(name=name, handler=func, plugin_id=self._current_plugin_id)
            )
            return func

        return decorator

    def find(self, command_id: str) -> Optional[Command]:
        for cmd in self.commands:
            if cmd.id == command_id:
                return cmd
        return None


# The single shared registry imported by every plugin.
plugin = Plugin()
