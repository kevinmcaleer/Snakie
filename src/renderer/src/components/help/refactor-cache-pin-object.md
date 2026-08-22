This pin is constructed more than once here — build it once and keep the object.

```python
def read_bumpers():
    left = Pin(14, Pin.IN, Pin.PULL_UP).value()
    right = Pin(15, Pin.IN, Pin.PULL_UP).value()
    front = Pin(14, Pin.IN, Pin.PULL_UP).value()   # ← the same pin again
```

## Why it matters

`Pin(14, …)` is not a lookup, it is a *constructor*. Each one
allocates a new object and re-applies the pad configuration — mode, pull,
drive strength — to a pin that was already set up. Two of them in the same
function is the beginner's mental model of `Pin` as a way of *naming* a pin
rather than a way of *claiming* one, and it costs heap on a board that has
none to lose. Worse, the two objects can disagree: reconfigure one and the
other still holds the old idea of the pad.

**Hint only.** The fix — hoist it to a module-level object, stash it on
`self`, hand it in as a parameter — is a design decision about who owns the
hardware, and that is the author's call, not ours. So Snakie points, names
the repeat, and offers no automatic rewrite; Snakie will not rewrite it for you.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
