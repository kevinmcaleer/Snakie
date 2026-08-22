A big literal at module level is built at import time and never freed.

```python
# before                              # after (by hand)
SINE_Q8 = [                           def sine_q8(index):
    128, 139, 150, 161, 172,              with open("sine.bin", "rb") as f:
    …72 entries in all…                       f.seek(index)
]                                             return f.read(1)[0]
```

## Why it matters

A literal at module level is not free storage the way a
constant in C is. The interpreter *builds* it — element by element — the first
time the module is imported, and the resulting list, dict or tuple then sits
on the heap for the entire life of the program whether anything reads it or
not. On a Pico you have around 190 KB of RAM in total, and a list of small
integers costs roughly eight bytes per slot before you count the objects
inside it. A 512-entry lookup table is therefore a measurable double-digit
slice of the heap, gone before `main()` has run a line.

There is a second cost people notice sooner: import time. Every element is a
separate bytecode operation, so a big table makes the board sit there after
reset doing nothing visible, which reads as "my Pico is slow to boot".

The ways out, roughly in order of how much they buy:

- **A `bytes` literal.** `b"\x80\x8b\x96…"` is *one* object, built in one
  step, and indexing it gives you the integer back. For a table of values
  under 256 this is usually a straight win and barely changes the code.
- **A file read on demand.** Move the table into a `.bin` next to the script
  and `seek()` to the entry you want. Costs a few hundred microseconds per
  lookup, costs nothing at all in RAM.
- **Compute it.** A table of 72 sine values is a `sin()` call and a loop; if
  the board can spare the cycles, it cannot spare the bytes.

Which of those is right depends entirely on how the table is used, so Snakie only points at it — it flags the table, says how big it is, and leaves the
choice to the author. It deliberately does **not** carry a `requires` board
gate: the arithmetic is just as true with nothing plugged in, and someone
writing code on the train should still be told. When a board *is* connected
and reported little free heap, the message says so.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
