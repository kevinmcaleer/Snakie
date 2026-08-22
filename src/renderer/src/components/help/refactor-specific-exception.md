A bare `except:` also swallows Ctrl-C and `sys.exit()` — name what you expect.

```python
try:                            try:
    with open(path) as f:           with open(path) as f:
        return f.read()                 return f.read()
except:                         except OSError:
    return DEFAULTS                 return DEFAULTS
```

A bare `except:` catches *everything* — including `KeyboardInterrupt`, so
Ctrl-C at the REPL no longer stops the program, and `SystemExit`, so
`sys.exit()` quietly carries on. It also hides your own typos: a
`NameError` in the `try` block looks exactly like the failure you were
expecting, and the robot drives on with the wrong value.

`except Exception:` is a strict improvement and is always correct — it is
everything a bare except caught minus the two things you never meant to
catch. That is what Snakie applies by default.

When every call in the `try` block is file or hardware I/O, the rule offers
`except OSError:` instead, because that is what a missing file or an
unplugged I2C device actually raises. It cannot always know: a body that
mixes I/O with parsing can raise `ValueError` just as easily, and narrowing
there would let a real bug escape. So the OSError form is only offered when
the body contains nothing else, and Snakie always asks you to confirm it —
changing which errors escape a handler is the user's call, never a batch
tidy's.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
