# snakie — the Snakie plugin SDK

The Python SDK for writing [Snakie](https://github.com/kevinmcaleer/Snakie)
editor plugins. Snakie spawns a Python host (`python3 -m snakie.host`) that
discovers and runs your plugins, talking to the Electron app over
newline-delimited JSON-RPC.

```bash
pip install snakie
```

```python
# ~/.snakie/plugins/my_plugin/__init__.py
from snakie import plugin, Context, message, edit

@plugin.command("hello", "Say hello")
def hello(ctx: Context):
    return message("info", f"Editing {ctx.file.name}")

@plugin.command("upper", "Uppercase the file")
def upper(ctx: Context):
    return edit(ctx.file.content.upper())
```

See `docs/writing-plugins.md` in the Snakie repository for the full quickstart.
