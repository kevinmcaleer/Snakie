"""Example Snakie plugin: Hello.

A minimal, dependency-free plugin demonstrating the two core action kinds:

* ``hello`` returns a *message* describing the active file.
* ``hello.upper`` returns an *edit* that uppercases the whole file.

Snakie ships this so the Plugins view works out of the box. Copy it into
``~/.snakie/plugins/`` to use it as a scaffold for your own plugin — see
``docs/writing-plugins.md``.
"""

from snakie import Context, edit, message, plugin


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
