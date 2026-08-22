The `u`-prefixed name is a deprecated alias — this try/except shim can go.

```python
# before                          # after
try:                              import json
    import ujson
except ImportError:
    import json
```

Every MicroPython tutorial written before about 2022 opens with one of these,
and beginners copy them forward for years. The shim is dead weight in both
directions: CPython only ever had `json`, and modern MicroPython provides
`json` too — the `u`-prefixed spellings are deprecated aliases kept for old
code, and several ports have already stopped shipping them by default. So the
`try` branch either succeeds and gives you the *same module under a worse
name*, or it fails and you fall through to the line you could have written on
its own.

What it costs is readability. Four lines and two indentation levels at the top
of the file, repeated once per module, before the reader has reached anything
the program actually does — and a habit that makes people think `ujson` and
`json` are two different things that must be reconciled.

The bare `import ujson` / `import json` form is worth knowing about: it is
quietly *broken*, because the two branches bind two different names. Code
below it that says `json.dumps(…)` blows up with `NameError` on precisely the
firmware where the `try` succeeded. Collapsing it to `import json` is the fix,
not just the tidy-up — which is why the rule declines whenever the file still
reads the `u`-prefixed name, since that program means something else.

The module names are whitelisted rather than derived by stripping a `u`:
`umqtt.simple` and `urequests` are real, separately-named packages, and
"importing them without the u" is not a thing.
