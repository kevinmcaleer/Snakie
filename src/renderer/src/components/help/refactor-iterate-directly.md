`range(len(...))` — loop over the sequence itself instead of an index.

```python
for i in range(len(readings)):     for reading in readings:
    if readings[i] > best:             if reading > best:
        best = readings[i]                 best = reading
```

`range(len(...))` is the single most common thing a beginner brings with them
from C, and it costs them twice: an index they have to keep in step by hand,
and a subscript on every use — which on a microcontroller is a real `__getitem__`
call per access, not free. Python's `for` already hands you the item.

When the index genuinely is needed as well — a pixel number, a channel id —
the answer is `enumerate`, not a manual counter:

```python
for i in range(len(pixels)):       for i, pixel in enumerate(pixels):
    strip.set_pixel(i, pixels[i])      strip.set_pixel(i, pixel)
```

The rule is deliberately timid about *which* `range(len(xs))` loops it will
touch. `for i in range(len(xs))` freezes the length once; `for item in xs`
follows the live sequence, so a body that appends to, pops from or reassigns
`xs` is a different program. We therefore insist that every mention of the
sequence inside the body is one of the `xs[i]` reads we are about to replace —
anything else (a `.append`, another `len`, a rebind) and we decline. Writing
*through* the index (`xs[i] = 0`) is declined for the same reason: that loop
is not iterating values, it is filling a buffer.

The one assumption left standing — the same one pylint's `consider-using-
enumerate` has made for years — is that `xs` is a **sequence**. Iterating a
dict yields its keys rather than `xs[i]`, but a dict indexed by `range(len(...))`
is already a list wearing the wrong type, so we let that one go.
