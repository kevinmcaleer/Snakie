This file is closed by hand — a `with` block closes it even when something goes wrong.

```python
f = open("log.csv", "w")        with open("log.csv", "w") as f:
f.write(header)             →       f.write(header)
f.write(row)                        f.write(row)
f.close()
```

A hand-written `open`/`close` pair only closes the file when everything in
between goes right. On a microcontroller that matters more than on a laptop:
an unflushed handle after a soft reset is how a logging sketch ends up with an
empty CSV, and the board has no operating system waiting to tidy up after it.
`with` closes the handle on the way out of the block whatever happens — the
exception path included.

The `try:` / `finally: f.close()` spelling is handled too, since that is what
a careful beginner writes once they hit the problem for the first time:

```python
f = open(path)                  with open(path) as f:
try:                        →       data = f.read()
    data = f.read()
finally:
    f.close()
```

**What Snakie deliberately will not touch.** If a `return`, `raise`,
`break` or `continue` sits between the plain `open` and the plain `close`, the
close is *already* being skipped on that path — which is precisely the bug
`with` fixes. Converting it would change what the program does rather than
just how it reads, so we decline and leave it to the human. (The `try`/
`finally` shape has no such problem: `finally` already runs on every path, so
an early `return` inside it is converted happily.)

## Before you apply it

- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
