"""Example Snakie plugin: lint demo.

A dependency-free analysis plugin demonstrating the **reactive linter** API.
Registered with ``@plugin.linter``, its handler runs automatically (debounced)
as you edit, returning :func:`~snakie.diagnostic` results that Snakie renders as
squiggles — with quick-fixes surfaced via the editor lightbulb.

Two rules:

* **Trailing whitespace** (``warning``) — flags spaces/tabs at the end of a
  line, offering a "Remove trailing whitespace" quick-fix that strips them.
* **TODO comments** (``info``) — flags ``# TODO`` markers so they are easy to
  spot; informational, no fix.

Copy this into ``~/.snakie/plugins/`` as a scaffold for your own linter — see
``docs/writing-plugins.md``.
"""

import re

from snakie import Context, diagnostic, fix, plugin

# A TODO marker in a comment: "# TODO", "# todo:", "#TODO ..." etc.
_TODO = re.compile(r"#\s*todo\b", re.IGNORECASE)


@plugin.linter("lint-demo")
def lint(ctx: Context):
    """Flag trailing whitespace and TODO comments in the active file."""
    diagnostics = []
    for index, line in enumerate(ctx.file.content.splitlines()):
        line_no = index + 1  # diagnostics are 1-based

        # Rule 1: trailing whitespace -> warning + strip fix.
        stripped = line.rstrip()
        if stripped != line:
            start_col = len(stripped) + 1  # 1-based column of first trailing ws
            end_col = len(line) + 1
            diagnostics.append(
                diagnostic(
                    line_no,
                    "Trailing whitespace",
                    severity="warning",
                    column=start_col,
                    end_column=end_col,
                    source="lint-demo",
                    fixes=[
                        fix(
                            "Remove trailing whitespace",
                            "",
                            line=line_no,
                            column=start_col,
                            end_line=line_no,
                            end_column=end_col,
                        )
                    ],
                )
            )

        # Rule 2: TODO comment -> info (no fix; informational marker).
        match = _TODO.search(line)
        if match:
            diagnostics.append(
                diagnostic(
                    line_no,
                    "TODO comment",
                    severity="info",
                    column=match.start() + 1,
                    end_column=len(line) + 1,
                    source="lint-demo",
                )
            )

    return diagnostics
