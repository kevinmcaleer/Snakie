Imports — bring modules (built-in, or files on the board) into your program.

## The forms

```python
import time                     # use as time.sleep(...)
from machine import Pin, PWM    # pull names in directly
import instruments as inst      # rename for brevity
```

## Where modules come from

`import servo` searches, in order:
1. built-ins compiled into the firmware (`machine`, `time`, `os`, …)
2. the board's filesystem: `/` then `/lib`

So installing a driver = copying `servo.py` to `/lib/servo.py` — exactly what
Snakie's Install buttons do (parts banner, Driver Install, Packages).

## Seeing what's available

```python
help("modules")     # every importable module on the board
```

## Gotchas

- An `ImportError` means the module isn't on the board — Snakie's banner
  offers a one-click install when a placed part needs it.
- Naming your own file the same as a module it imports (a `time.py` that does
  `import time`) shadows the real one — pick a different filename.
- Modules run ONCE on first import (then they're cached in `sys.modules`);
  a soft reset (Ctrl-D) clears the cache and re-runs them.
