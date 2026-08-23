The file can vanish between the check and the open — open it and catch `OSError`.

```python
if os.path.exists(path):        try:
    with open(path) as f:           with open(path) as f:
        return f.read()                 return f.read()
                                except OSError:
                                    pass
```

"Easier to Ask Forgiveness than Permission" is not just Python taste — the
check is a lie. `exists()` answers a question about a moment that has already
passed by the time `open()` runs: another program (or the USB host copying
files onto your board) can delete it in between, the SD card can be pulled,
the flash can be full. The `open()` has to be able to fail anyway, so the
`if` buys nothing and doubles the filesystem work.

On a microcontroller there is a second reason: MicroPython's `os` module is
a cut-down build and `os.path` often is not there at all, so the "safe"
version is the one that raises `AttributeError` on the board while the
try/except runs everywhere.

Snakie asks you to confirm this one, because the rewrite changes which errors surface. Before, a missing
file skipped the block silently; afterwards an unreadable-but-present file
is caught too, and anything else in the block that raises `OSError` now lands
in the same handler. That trade is the user's to accept.

An `if`/`else` is declined outright — the `else` branch is the "file was
missing" path, and whether it belongs in the `except` or after the whole
`try` is a judgement about intent that only the author can make.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
