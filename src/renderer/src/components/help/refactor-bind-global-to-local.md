This global is a dictionary lookup on every pass — bind it to a local first.

```python
# before                          # after
THRESHOLD = 500                   THRESHOLD = 500

def scan(samples):                def scan(samples):
    hits = 0                          limit = THRESHOLD
    for s in samples:                 hits = 0
        if s > THRESHOLD:             for s in samples:
            hits += 1                     if s > limit:
    return hits                               hits += 1
                                      return hits
```

## Why it matters

A local variable is a numbered slot. The compiler works out
which slot at compile time, so reading one is an array index — about as fast
as anything MicroPython does. A *global* is a name in the module's dictionary,
and reading it means hashing the string and probing that dictionary, every
single time, on every pass of the loop.

That is the second recommendation in the official *Maximising MicroPython
speed* guide, and it costs one line. It matters most for the things people
reach for most: a module-level threshold, a helper function called in a tight
loop, an imported name like `sqrt`.

Snakie only points at it, for two reasons. The first is that the *name* of the
local is a readability decision — `limit = THRESHOLD` reads well, `THRESHOLD =
THRESHOLD` does not, and only you know what the value means here. The second
matters more: **if anything reassigns that global while the loop runs, caching
it changes behaviour.** A flag set by an interrupt handler is exactly that
case, and it is common in robot code — bind it to a local and your loop stops
noticing the interrupt. Snakie cannot see an interrupt coming, so it will not
make this change for you.

Constants written in `const()` are skipped: the compiler already inlines those
at every use site, so there is nothing left to look up.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
