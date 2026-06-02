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
below (or a list of them): :func:`message`, :func:`edit`, :func:`diagnostic`.
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
    "message",
    "edit",
    "diagnostic",
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


def diagnostic(
    line: int,
    message: str,
    *,
    severity: str = "warning",
    column: Optional[int] = None,
    end_line: Optional[int] = None,
    end_column: Optional[int] = None,
    source: str = "snakie",
) -> Action:
    """Produce a single diagnostic action (problem marker).

    ``severity`` is one of ``error``, ``warning``, ``info``, ``hint``.
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
    return {"type": "diagnostic", "item": item}


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


class Plugin:
    """The shared registry that ``@plugin.command`` writes to.

    A single module-level instance (:data:`plugin`) is shared across every
    imported plugin. The host tags each command with the plugin module it was
    imported from so the UI can group commands by plugin.
    """

    def __init__(self) -> None:
        self.commands: List[Command] = []
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

    def linter(self, name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Reserved for the linter feature (separate issue).

        Registering is a no-op in the MVP — kept so plugins that use it import
        cleanly. Returns the function unchanged.
        """

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            return func

        return decorator

    def find(self, command_id: str) -> Optional[Command]:
        for cmd in self.commands:
            if cmd.id == command_id:
                return cmd
        return None


# The single shared registry imported by every plugin.
plugin = Plugin()
