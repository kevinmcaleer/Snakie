Nothing ever shortens this list — on a 264 KB board it ends in MemoryError.

```python
samples = []

while True:
    samples.append(sensor.read_u16())   # nothing ever takes one back out
    time.sleep_ms(100)
```

Ten samples a second, a tuple each, and a Pico's 264 KB of RAM: the numbers
are fine for the first minute, fine for the tenth, and then the allocator
cannot find a free block and the program dies with
`MemoryError: memory allocation failed`. Nothing in the code is wrong in the
way a typo is wrong — it simply assumes a computer with a hard disc and an
operating system underneath it, and there isn't one. A microcontroller has
exactly the RAM it shipped with, and a list is the easiest way in the world to
spend all of it.

The cruel part is the timing. Twenty minutes is longer than any bench test
anyone runs, so this passes every check on the desk and fails on the robot,
mid-run, with the wheels still turning — and the traceback lands wherever the
next allocation happened to be, which is usually nowhere near the `.append()`
that caused it.

There are two good fixes and the code cannot tell us which one is wanted:

- a **ring buffer** — a fixed-size list (or, better, a `bytearray` /
  `array.array`) with an index that wraps, so the memory is claimed once at
  import time and never grows again;
- **streaming** — open the log file, write each row as it arrives, keep one
  row in RAM at a time.

Which is right depends on whether the data is wanted later or only recently,
and on whether there is a filesystem worth writing to. That is a design
decision, so the rule is `hintOnly`: it points at the list, explains what will
happen, and never rewrites anything.

It goes out of its way not to cry wolf. It fires only on a list that starts
empty, is appended to inside a loop that never ends, and that **nothing in the
file ever shortens** — no `.pop()`, `.clear()` or `.remove()`, no `del`, no
`buf[:] = …` slice assignment, and no `len(buf)` sitting in a comparison,
which is what a hand-rolled cap looks like. A second binding of the name — a
`buf = buf[-100:]`, a periodic `buf = []`, a parameter or a local of the same
name somewhere else — also stands the hint down, because then we cannot prove
the list we are looking at is the list that grows. A bounded
`for i in range(10)` is not an unbounded loop and never fires: filling a
lookup table is not a leak.

It also stays on plain names. `self.rows.append(…)` leaks exactly as badly,
but proving that `self` is the same object at the `[]` and at the `append`
needs more than this file's text can give us, so an attribute is left alone
rather than guessed at.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
