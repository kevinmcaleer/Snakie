This `if` wraps the whole function — an early return would flatten it.

The commonest shape in beginner code, and the easiest big win:

```python
def read_sensor(bus):          def read_sensor(bus):
    if bus is not None:            if bus is None:
        raw = bus.read()               return
        scaled = raw / 16        raw = bus.read()
        return scaled            scaled = raw / 16
                                 return scaled
```

Arjan Egges puts it well: *the happy path should be the least-indented path*.
Deal with the cases you cannot handle first, get them out of the way with an
early `return`, and everything left is the real work — reading straight down
the page instead of stepping sideways first.

It compounds. Every nested `if` you remove is one less level of indentation for
everything that follows, and one less condition to hold in your head while you
read the part you actually came for. On a long function it is the difference
between code you can skim and code you have to trace.

The rewrite inverts your condition rather than negating it wholesale, so
`bus is not None` becomes `bus is None` rather than `not (bus is not None)`.
Where a condition cannot be inverted cleanly — a chained comparison like
`0 < x < 10`, whose opposite is emphatically *not* `0 >= x >= 10` — it wraps
the whole thing in `not (…)`, which is always correct even when it is less
pretty.
