"""Bundled Snakie linter: real Python linting via ruff (or pyflakes).

Registered with ``@plugin.linter("python")``, this runs reactively as you edit a
``.py`` file and surfaces real diagnostics — squiggles in the editor and rows in
the Problems panel — using whichever linter tool is installed:

* **ruff** (preferred) — fast, rich rule set, and *quick-fixes*. Run as
  ``ruff check --output-format json --stdin-filename <name> -`` with the file
  content on stdin. Each JSON item becomes a :func:`~snakie.diagnostic`; an item
  carrying a single-edit ``fix`` becomes a ranged quick-fix (editor lightbulb).
* **pyflakes** (fallback) — found if ruff is not. No fixes; flags unused
  imports, undefined names, etc. The content is written to a temp file, linted,
  then the temp file is removed.
* **neither** — the linter returns ``[]`` (no squiggles). The ``python_linter.status``
  command reports which tool (if any) was found so the UI can hint
  "install ruff".

The tool is auto-detected (PATH console script first, else ``python -m <tool>``).
Choosing ruff-vs-pyflakes explicitly is a follow-up.

Parsing lives in pure, importable functions — :func:`parse_ruff_json` and
:func:`parse_pyflakes_output` — so they unit-test with canned input and no tool
installed (see ``python/tests/test_python_linter.py``).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional, Tuple

from snakie import Context, diagnostic, fix, plugin

# How long (seconds) to wait for a linter subprocess before giving up. Linting
# must never hang the editor, so we cap it and treat a timeout as "no results".
_TIMEOUT_S = 10


# ---------------------------------------------------------------------------
# Pure parsers (unit-tested with canned input — no tool needed)
# ---------------------------------------------------------------------------


def _severity_for_ruff_code(code: str) -> str:
    """Map a ruff rule code to a diagnostic severity.

    Kept deliberately simple: syntax errors (``E9*``) and pyflakes-class errors
    (``F*``) are surfaced as ``error``; everything else is a ``warning``.
    """
    if not code:
        return "warning"
    if code.startswith("E9") or code.startswith("F"):
        return "error"
    return "warning"


def _ruff_fix_from(item: Dict[str, Any], code: str) -> Optional[Dict[str, Any]]:
    """Build a quick-fix from a ruff item's ``fix`` (common single-edit case).

    ruff's ``fix`` is ``{message, edits: [{content, location, end_location}]}``
    where each location is ``{row, column}`` (1-based row, 1-based column). We
    support the common single-edit fix; multi-edit fixes are skipped (the host
    only needs a ranged replacement and ruff overwhelmingly emits one edit).
    """
    fx = item.get("fix")
    if not isinstance(fx, dict):
        return None
    edits = fx.get("edits")
    if not isinstance(edits, list) or len(edits) != 1:
        return None
    edit = edits[0]
    if not isinstance(edit, dict):
        return None
    loc = edit.get("location") or {}
    end = edit.get("end_location") or {}
    title = str(fx.get("message") or f"Fix {code}".strip() or "Fix")
    return fix(
        title,
        str(edit.get("content", "")),
        line=_int_or_none(loc.get("row")),
        column=_int_or_none(loc.get("column")),
        end_line=_int_or_none(end.get("row")),
        end_column=_int_or_none(end.get("column")),
    )


def _int_or_none(value: Any) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def parse_ruff_json(stdout: str) -> List[Dict[str, Any]]:
    """Parse ``ruff check --output-format json`` output into diagnostic dicts.

    ``stdout`` is a JSON array of items, each like::

        {
          "code": "F401",
          "message": "`os` imported but unused",
          "location": {"row": 1, "column": 8},
          "end_location": {"row": 1, "column": 10},
          "fix": {"message": "Remove unused import: `os`",
                  "edits": [{"content": "", "location": {...}, "end_location": {...}}]}
        }

    Returns a list of bare Diagnostic dicts (the host normalises the
    :func:`~snakie.diagnostic` action form too). Robust to an empty/blank body
    (ruff prints ``[]`` when clean) and to items missing optional fields.
    """
    text = stdout.strip()
    if not text:
        return []
    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(items, list):
        return []

    diagnostics: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        loc = item.get("location") or {}
        row = _int_or_none(loc.get("row"))
        if row is None:
            continue
        col = _int_or_none(loc.get("column"))
        end = item.get("end_location") or {}
        end_row = _int_or_none(end.get("row"))
        end_col = _int_or_none(end.get("column"))
        code = str(item.get("code") or "").strip()
        raw_message = str(item.get("message") or "")
        message = f"{code}: {raw_message}" if code else raw_message
        fixes = None
        built = _ruff_fix_from(item, code)
        if built is not None:
            fixes = [built]
        diagnostics.append(
            diagnostic(
                row,
                message,
                severity=_severity_for_ruff_code(code),
                column=col,
                end_line=end_row,
                end_column=end_col,
                source="ruff",
                fixes=fixes,
            )
        )
    return diagnostics


def parse_pyflakes_output(stdout: str, filename: str) -> List[Dict[str, Any]]:
    """Parse pyflakes' ``path:line:col: message`` text into diagnostic dicts.

    pyflakes writes one finding per line as ``path:line:col: message`` (the
    column is optional on some versions: ``path:line: message``). ``filename`` is
    the temp path we linted; it is stripped from the message so the user sees
    only the human-readable text. Lines that do not match the pattern (banners,
    blank lines) are ignored. No quick-fixes (pyflakes does not provide edits).
    """
    diagnostics: List[Dict[str, Any]] = []
    for raw in stdout.splitlines():
        line = raw.rstrip()
        if not line:
            continue
        parsed = _parse_pyflakes_line(line, filename)
        if parsed is None:
            continue
        row, col, message = parsed
        diagnostics.append(
            diagnostic(
                row,
                message,
                severity="warning",
                column=col,
                source="pyflakes",
            )
        )
    return diagnostics


def _parse_pyflakes_line(
    line: str, filename: str
) -> Optional[Tuple[int, Optional[int], str]]:
    """Parse one pyflakes report line -> ``(row, column?, message)`` or None.

    Handles both ``<path>:<row>:<col>: <message>`` and the older
    ``<path>:<row>: <message>``. The leading path must match the temp filename we
    linted (so stray colons in a message body are not mistaken for fields).
    """
    prefix = filename + ":"
    if not line.startswith(prefix):
        return None
    rest = line[len(prefix):]
    # rest is "<row>:<col>: <message>" or "<row>: <message>"
    head, sep, message = rest.partition(": ")
    if not sep:
        return None
    parts = head.split(":")
    row = _int_or_none(parts[0])
    if row is None:
        return None
    col = _int_or_none(parts[1]) if len(parts) > 1 else None
    return row, col, message


# ---------------------------------------------------------------------------
# Tool detection + invocation
# ---------------------------------------------------------------------------


def _console_script(name: str) -> Optional[List[str]]:
    """Return the argv prefix for a tool on PATH, or None."""
    path = shutil.which(name)
    return [path] if path else None


def _module_runnable(name: str) -> Optional[List[str]]:
    """Return ``[python, -m, name]`` if ``python -m name`` imports, else None."""
    try:
        proc = subprocess.run(
            [sys.executable, "-c", f"import {name}"],
            capture_output=True,
            timeout=_TIMEOUT_S,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode == 0:
        return [sys.executable, "-m", name]
    return None


def detect_tool() -> Optional[Tuple[str, List[str]]]:
    """Detect an available linter, preferring ruff.

    Returns ``(tool_name, argv_prefix)`` or ``None``. ruff is tried first as a
    PATH console script, then ``python -m ruff``; then pyflakes the same way.
    """
    for name in ("ruff", "pyflakes"):
        argv = _console_script(name) or _module_runnable(name)
        if argv is not None:
            return name, argv
    return None


def _run(argv: List[str], stdin_text: str) -> Optional[subprocess.CompletedProcess]:
    """Run ``argv`` feeding ``stdin_text``; None on failure/timeout."""
    try:
        return subprocess.run(
            argv,
            input=stdin_text,
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_S,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _lint_with_ruff(argv: List[str], filename: str, content: str) -> List[Dict[str, Any]]:
    proc = _run(
        [*argv, "check", "--output-format", "json", "--stdin-filename", filename, "-"],
        content,
    )
    if proc is None:
        return []
    return parse_ruff_json(proc.stdout)


def _lint_with_pyflakes(argv: List[str], content: str) -> List[Dict[str, Any]]:
    # pyflakes has no stdin mode that reports a stable filename, so write a temp
    # file, lint it, and clean up. Findings are keyed on the temp path, which we
    # strip back out in the parser.
    fd, tmp_path = tempfile.mkstemp(suffix=".py", prefix="snakie_lint_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        proc = _run([*argv, tmp_path], "")
        if proc is None:
            return []
        # pyflakes prints findings to stdout; syntax errors go to stderr.
        combined = (proc.stdout or "") + (proc.stderr or "")
        return parse_pyflakes_output(combined, tmp_path)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# The linter + status command
# ---------------------------------------------------------------------------


def _is_python(ctx: Context) -> bool:
    name = (ctx.file.name or "").lower()
    return name.endswith(".py")


@plugin.linter("python")
def lint(ctx: Context) -> List[Dict[str, Any]]:
    """Lint the active ``.py`` file with ruff (or pyflakes); ``[]`` otherwise."""
    if not _is_python(ctx):
        return []
    content = ctx.file.content
    if not content.strip():
        return []
    detected = detect_tool()
    if detected is None:
        return []  # no tool: stay quiet rather than spam the editor
    tool, argv = detected
    filename = ctx.file.name or "untitled.py"
    if tool == "ruff":
        return _lint_with_ruff(argv, filename, content)
    return _lint_with_pyflakes(argv, content)


@plugin.command("python_linter.status", "Python Linter: status")
def status(ctx: Context):
    """Report which linter tool was detected, for the Problems-panel hint.

    Returns an ``info`` message *action* whose text is the tool name (``ruff`` /
    ``pyflakes``) or ``none``. The renderer reads ``action.text`` to decide
    whether to show the "Install ruff" hint.
    """
    detected = detect_tool()
    tool = detected[0] if detected else "none"
    from snakie import message

    return message("info", tool)
