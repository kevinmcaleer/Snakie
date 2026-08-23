This loop only appends — a list comprehension says it in one line.

```python
readings = []                          readings = [p.read_u16() for p in pins]
for p in pins:
    readings.append(p.read_u16())

fast = []                              fast = [s for s in samples if s > 900]
for s in samples:
    if s > 900:
        fast.append(s)
```

An empty list followed by a loop that only appends is one idea written as
three statements: *this list is that sequence, transformed*. The comprehension
says it in one line, and the reader no longer has to hold "is anything else
happening to `readings` in there?" in their head while they scan the loop.

**The on-device caveat, which is why Snakie is fussier here than a desktop
linter would be:** a comprehension allocates the whole list up front, so on a
microcontroller with tens of kilobytes of heap it can be *worse* than
appending — a big enough allocation fails outright where a slowly-growing list
would have survived, and it cannot be swapped for a generator later without
rewriting the line. That is why we never offer it for `range(N)` with a large
literal bound: at that size the loop is the kinder shape, and the honest
advice is a generator expression, not a list.

The rule also declines when the loop variable is read after the loop —
a `for` leaks its target, a comprehension does not.
