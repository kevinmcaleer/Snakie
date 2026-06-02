"""Snakie plugin host.

Run as ``python3 -m snakie.host`` (or directly as a script). The Electron main
process spawns this and talks to it over **newline-delimited JSON-RPC on
stdin/stdout**. The host:

1. Discovers plugins (``~/.snakie/plugins/*.py`` and ``*/__init__.py``, plus any
   directories passed via ``--plugin-dir`` / the ``SNAKIE_PLUGIN_DIRS`` env var —
   Snakie uses this to add its bundled ``examples/plugins`` dir; entry points are
   discovered too when ``importlib.metadata`` finds the ``snakie.plugins`` group).
2. Imports each, running its ``@plugin.command`` decorators. A per-plugin import
   error is reported in the plugin list, not fatal.
3. Serves the JSON-RPC loop: ``initialize``, ``listCommands``,
   ``runCommand``, ``lint``, ``shutdown``.

Protocol
--------
Requests are ``{"id", "method", "params"}``; responses are
``{"id", "result"}`` or ``{"id", "error": {"message"}}``. One JSON object per
line. stdout carries only protocol messages — anything a plugin prints to
stdout is redirected to stderr so it cannot corrupt the channel.
"""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure the SDK package is importable when run directly as a script (not just
# as ``-m snakie.host``): add this file's parent dir (the one containing the
# ``snakie`` package) to sys.path.
_PKG_PARENT = str(Path(__file__).resolve().parent.parent)
if _PKG_PARENT not in sys.path:
    sys.path.insert(0, _PKG_PARENT)

from snakie import Context, plugin  # noqa: E402  (after sys.path tweak)


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def _default_plugin_dir() -> Path:
    return Path.home() / ".snakie" / "plugins"


def _candidate_dirs(extra_dirs: List[str]) -> List[Path]:
    """Directories to scan for plugins, de-duplicated, existing first."""
    dirs: List[Path] = [_default_plugin_dir()]
    env = os.environ.get("SNAKIE_PLUGIN_DIRS", "")
    if env:
        dirs.extend(Path(p) for p in env.split(os.pathsep) if p)
    dirs.extend(Path(p) for p in extra_dirs if p)
    seen: set = set()
    out: List[Path] = []
    for d in dirs:
        key = str(d)
        if key not in seen:
            seen.add(key)
            out.append(d)
    return out


def _discover_paths(extra_dirs: List[str]) -> List[Path]:
    """Find plugin entry files: ``dir/*.py`` and ``dir/*/__init__.py``."""
    found: List[Path] = []
    for base in _candidate_dirs(extra_dirs):
        if not base.is_dir():
            continue
        for child in sorted(base.iterdir()):
            if child.name.startswith((".", "_")):
                continue
            if child.is_file() and child.suffix == ".py":
                found.append(child)
            elif child.is_dir() and (child / "__init__.py").is_file():
                found.append(child / "__init__.py")
    return found


def _plugin_id_for(path: Path) -> str:
    """A stable, human-readable id for a discovered plugin file."""
    if path.name == "__init__.py":
        return path.parent.name
    return path.stem


def _import_from_path(plugin_id: str, path: Path) -> None:
    """Import a plugin file under a unique module name and run its decorators."""
    mod_name = f"snakie_plugin_{plugin_id}"
    spec = importlib.util.spec_from_file_location(mod_name, str(path))
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load spec for {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)


def _discover_entry_point_plugins() -> List[Dict[str, Any]]:
    """Discover ``snakie.plugins`` entry points (bonus; best-effort)."""
    infos: List[Dict[str, Any]] = []
    try:
        from importlib.metadata import entry_points
    except Exception:  # pragma: no cover - very old Python
        return infos
    try:
        eps = entry_points()
        # Python 3.10+ returns a SelectableGroups; older returns a dict.
        group = (
            eps.select(group="snakie.plugins")
            if hasattr(eps, "select")
            else eps.get("snakie.plugins", [])  # type: ignore[attr-defined]
        )
    except Exception:
        return infos
    for ep in group:
        pid = ep.name
        info: Dict[str, Any] = {"id": pid, "name": pid, "source": "entry-point"}
        try:
            plugin._current_plugin_id = pid
            ep.load()
            info["ok"] = True
        except Exception as exc:  # noqa: BLE001 - report per-plugin
            info["ok"] = False
            info["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            plugin._current_plugin_id = ""
        infos.append(info)
    return infos


def discover(extra_dirs: List[str]) -> List[Dict[str, Any]]:
    """Discover and import every plugin. Returns per-plugin info records.

    Each record is ``{id, name, path?, source, ok, error?}``. Import errors are
    captured per-plugin and reported, never raised.
    """
    infos: List[Dict[str, Any]] = []
    for path in _discover_paths(extra_dirs):
        pid = _plugin_id_for(path)
        info: Dict[str, Any] = {
            "id": pid,
            "name": pid,
            "path": str(path),
            "source": "directory",
        }
        try:
            plugin._current_plugin_id = pid
            _import_from_path(pid, path)
            info["ok"] = True
        except Exception as exc:  # noqa: BLE001 - report per-plugin, not fatal
            info["ok"] = False
            info["error"] = f"{type(exc).__name__}: {exc}"
            print(
                f"snakie.host: failed to import plugin {pid}: {exc}",
                file=sys.stderr,
            )
        finally:
            plugin._current_plugin_id = ""
        infos.append(info)

    infos.extend(_discover_entry_point_plugins())
    return infos


# ---------------------------------------------------------------------------
# Command execution
# ---------------------------------------------------------------------------


def _commands_payload() -> List[Dict[str, str]]:
    return [
        {"id": c.id, "title": c.title, "pluginId": c.plugin_id}
        for c in plugin.commands
    ]


def _normalise_actions(result: Any) -> List[Dict[str, Any]]:
    """Coerce a command's return value into a list of action dicts."""
    if result is None:
        return []
    if isinstance(result, dict):
        return [result]
    if isinstance(result, (list, tuple)):
        return [a for a in result if isinstance(a, dict)]
    # A bare string is treated as an info message for convenience.
    if isinstance(result, str):
        return [{"type": "message", "level": "info", "text": result}]
    return []


def _run_command(params: Dict[str, Any]) -> Dict[str, Any]:
    command_id = params.get("commandId")
    cmd = plugin.find(command_id) if command_id else None
    if cmd is None:
        raise ValueError(f"unknown command: {command_id!r}")
    ctx = Context.from_dict(params.get("context"))
    result = cmd.handler(ctx)
    return {"actions": _normalise_actions(result)}


def _normalise_diagnostic(item: Any) -> Optional[Dict[str, Any]]:
    """Coerce a linter's diagnostic into a bare Diagnostic dict, or None.

    Accepts either the bare ``{line, message, ...}`` shape or the action form
    ``{"type": "diagnostic", "item": {...}}`` returned by ``snakie.diagnostic``.
    """
    if not isinstance(item, dict):
        return None
    if item.get("type") == "diagnostic" and isinstance(item.get("item"), dict):
        item = item["item"]
    if "line" not in item or "message" not in item:
        return None
    # Re-serialise to a plain JSON dict, preserving only known keys + fixes.
    out: Dict[str, Any] = {
        "line": int(item.get("line", 1)),
        "severity": str(item.get("severity", "warning")),
        "message": str(item.get("message", "")),
        "source": str(item.get("source", "snakie")),
    }
    for key in ("column", "endLine", "endColumn"):
        if item.get(key) is not None:
            out[key] = int(item[key])
    fixes = item.get("fixes")
    if isinstance(fixes, (list, tuple)):
        clean_fixes = [_normalise_fix(f) for f in fixes]
        clean_fixes = [f for f in clean_fixes if f is not None]
        if clean_fixes:
            out["fixes"] = clean_fixes
    return out


def _normalise_fix(fx: Any) -> Optional[Dict[str, Any]]:
    """Coerce a quick-fix into a plain ``{title, edit:{...}}`` JSON dict."""
    if not isinstance(fx, dict):
        return None
    edit_in = fx.get("edit")
    if not isinstance(edit_in, dict) or "newText" not in edit_in:
        return None
    edit_out: Dict[str, Any] = {"newText": str(edit_in["newText"])}
    for key in ("line", "column", "endLine", "endColumn"):
        if edit_in.get(key) is not None:
            edit_out[key] = int(edit_in[key])
    return {"title": str(fx.get("title", "Fix")), "edit": edit_out}


def _run_lint(params: Dict[str, Any]) -> Dict[str, Any]:
    """Run every registered linter and concatenate their diagnostics.

    A failure in one linter is captured (reported to stderr) and does not abort
    the others or the whole lint.
    """
    ctx = Context.from_dict(params.get("context"))
    diagnostics: List[Dict[str, Any]] = []
    actions: List[Dict[str, Any]] = []
    for ln in plugin.linters:
        try:
            result = ln.handler(ctx)
        except Exception as exc:  # noqa: BLE001 - per-linter isolation
            print(
                f"snakie.host: linter {ln.name!r} failed: {exc}",
                file=sys.stderr,
            )
            continue
        if result is None:
            continue
        items = result if isinstance(result, (list, tuple)) else [result]
        for raw in items:
            # A linter may also return a `status` action; surface it alongside
            # the diagnostics so the status bar can render it.
            if isinstance(raw, dict) and raw.get("type") == "status":
                actions.append(raw)
                continue
            diag = _normalise_diagnostic(raw)
            if diag is not None:
                diagnostics.append(diag)
    out: Dict[str, Any] = {"diagnostics": diagnostics}
    if actions:
        out["actions"] = actions
    return out


# ---------------------------------------------------------------------------
# JSON-RPC loop
# ---------------------------------------------------------------------------


class Host:
    def __init__(self, extra_dirs: List[str]) -> None:
        self.extra_dirs = extra_dirs
        self.plugins: List[Dict[str, Any]] = []
        self._discovered = False

    def _ensure_discovered(self) -> None:
        if not self._discovered:
            self.plugins = discover(self.extra_dirs)
            self._discovered = True

    def handle(self, method: str, params: Dict[str, Any]) -> Any:
        if method == "initialize":
            self._ensure_discovered()
            return {"plugins": self.plugins}
        if method == "listCommands":
            self._ensure_discovered()
            return {"commands": _commands_payload()}
        if method == "runCommand":
            self._ensure_discovered()
            return _run_command(params)
        if method == "lint":
            self._ensure_discovered()
            return _run_lint(params)
        if method == "shutdown":
            return {"ok": True}
        raise ValueError(f"unknown method: {method!r}")

    def serve(self, stdin: Any, stdout: Any) -> None:
        for raw in stdin:
            line = raw.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as exc:
                _write(stdout, {"id": None, "error": {"message": f"invalid JSON: {exc}"}})
                continue

            req_id = request.get("id")
            method = request.get("method", "")
            params = request.get("params") or {}
            try:
                result = self.handle(method, params)
                _write(stdout, {"id": req_id, "result": result})
            except Exception as exc:  # noqa: BLE001 - report, keep serving
                _write(
                    stdout,
                    {
                        "id": req_id,
                        "error": {
                            "message": f"{type(exc).__name__}: {exc}",
                            "traceback": traceback.format_exc(),
                        },
                    },
                )
            if method == "shutdown":
                break


def _write(stream: Any, obj: Dict[str, Any]) -> None:
    stream.write(json.dumps(obj) + "\n")
    stream.flush()


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="snakie.host", description="Snakie plugin host")
    parser.add_argument(
        "--plugin-dir",
        action="append",
        default=[],
        dest="plugin_dirs",
        help="Extra directory to scan for plugins (repeatable).",
    )
    args = parser.parse_args(argv)

    # Protect the protocol channel: a plugin printing to stdout must not corrupt
    # JSON-RPC, so redirect process stdout to stderr and keep the real stdout
    # only for our own writes.
    protocol_out = sys.stdout
    sys.stdout = sys.stderr

    host = Host(extra_dirs=list(args.plugin_dirs))
    host.serve(sys.stdin, protocol_out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
