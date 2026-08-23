Building a string with `+=` in a loop is O(n²) and fragments the heap.

```python
line = ""                     parts = []
for reading in readings:      for reading in readings:
    line += "%d," % reading       parts.append("%d," % reading)
                              line = "".join(parts)
```

This one is a `warning`, not a style hint, because on a microcontroller it is
a real performance bug. Python strings are immutable, so `line += piece`
allocates a brand-new string and copies everything accumulated so far —
building an *n*-piece string costs O(n²) copying. On CPython you may never
notice; on a Pico with a few tens of kilobytes of heap you notice twice: the
loop slows down as it goes, and every discarded intermediate leaves a hole
that fragments the heap until an allocation that *should* fit fails.

Appending to a list and joining once at the end does a single allocation of
the final size. Same output, one copy.

The rule declines when the accumulator is read inside the loop, when the loop
has an `else`, and when the loop sits in a `try` body — there, an exception
mid-loop leaves the original holding a partial string and the rewrite holding
an empty one, which is a difference a handler could see.

## Before you apply it

- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
