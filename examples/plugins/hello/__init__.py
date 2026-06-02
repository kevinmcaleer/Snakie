"""Example Snakie plugin: Hello.

A minimal, dependency-free plugin demonstrating the two core action kinds:

* ``hello`` returns a *message* describing the active file.
* ``hello.upper`` returns an *edit* that uppercases the whole file.
* ``hello.status`` posts a clickable *status*-bar message.

Snakie ships this so the Plugins view works out of the box. Copy it into
``~/.snakie/plugins/`` to use it as a scaffold for your own plugin — see
``docs/writing-plugins.md``.
"""

from snakie import Context, edit, message, plugin, status


@plugin.command("hello", "Hello")
def hello(ctx: Context):
    """Greet the user with the active file's name and size."""
    name = ctx.file.name or "(no file)"
    size = len(ctx.file.content)
    return message("info", f"Hello from Snakie! Editing {name} ({size} chars).")


@plugin.command("hello.upper", "Uppercase file")
def uppercase(ctx: Context):
    """Replace the active file's contents with an uppercased version."""
    return edit(ctx.file.content.upper())


@plugin.command("hello.status", "Show status link")
def show_status(ctx: Context):
    """Post a clickable message to the status bar linking to the docs."""
    lines = ctx.file.content.count("\n") + 1 if ctx.file.content else 0
    return status(
        f"Hello: {lines} line(s)",
        tooltip="Open the Snakie plugin docs",
        href="https://github.com/kevinmcaleer/Snakie",
        priority=1,
    )
