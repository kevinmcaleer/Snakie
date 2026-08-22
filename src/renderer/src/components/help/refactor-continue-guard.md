This `if` wraps the whole loop body — `continue` would flatten it.

The guard clause ("Convert to guard clause"), but for loops: when a loop body is nothing but one
big `if`, the interesting work is indented for a condition that has already
been decided.

```python
for reading in samples:          for reading in samples:
    if reading > threshold:          if reading <= threshold:
        count += 1                       continue
        log(reading)                 count += 1
                                     log(reading)
```

`continue` skips to the next iteration, which is precisely what falling off
the end of the `if` did before — so the rewrite preserves behaviour exactly,
including a `for … else`, which only an unrelated `break` can skip.

The reason to do it is readability under nesting: on a microcontroller these
loops grow (debounce, then range check, then a flag) and each new condition
costs another level. As guards they stay a flat list of reasons to skip this
reading, with the real work at the bottom, unindented.
