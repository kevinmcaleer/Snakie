This `if` only wraps another `if` — the two conditions can be joined with `and`.

An `if` whose entire body is another `if` is one condition wearing two coats:

```python
if self.enabled:                 if self.enabled and link.rssi > -70:
    if link.rssi > -70:              publish(link.reading())
        publish(link.reading())
```

`and` short-circuits, so the merged form evaluates exactly what the nested
form did, in the same order, and stops at the same point — `link.rssi` is
still never touched when `self.enabled` is false. What changes is the reading:
one level of indentation disappears, and the two things that must both be true
are stated together instead of a screen apart.

Care is taken in three places. An `or` on either side is parenthesised, so
`if a or b:` inside `if c:` becomes `if c and (a or b):` and not the very
different `if c and a or b:`. A comment written between the two headers is
kept — it travels down into the merged body rather than being deleted with the
inner header line. And a trailing comment ON the inner header (`if b:  # why`)
has nowhere to go, so the rule declines rather than lose it.
