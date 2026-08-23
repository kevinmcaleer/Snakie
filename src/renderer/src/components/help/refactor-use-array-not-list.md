A list of numbers costs a pointer plus a boxed object each — an array.array does not.

```python
# before                              # after (by hand)
GAMMA = [0, 1, 2, 4, 7, 11,           from array import array
         17, 25, 36, 50, 68]
history = [0] * 64                    GAMMA = array("B", [0, 1, 2, 4, 7, 11,
                                                         17, 25, 36, 50, 68])
                                      history = array("h", [0] * 64)
```

## Why it matters

A Python **list of 100 ints is not 100 ints**. It is 100
pointers — four bytes each — *plus* 100 separate integer objects on the heap
for them to point at, each with its own type header. On a 32-bit MicroPython
port that is comfortably 1.2 KB for a hundred small numbers, scattered across
the heap so the garbage collector has to walk all of it.

`array.array('h', …)` is 100 signed 16-bit values in one contiguous block:
**200 bytes, full stop.** No pointers, no boxing, no per-item headers, nothing
for the collector to trace inside it. On a Pico with 264 KB of RAM that
difference is not a micro-optimisation — for a lookup table, a sample buffer
or a gait sequence it is what decides whether your program starts at all.

The typecodes worth knowing:

| Code | Holds | Bytes each |
|---|---|---|
| `'b'` / `'B'` | signed / unsigned byte, −128…127 or 0…255 | 1 |
| `'h'` / `'H'` | signed / unsigned 16-bit, ±32767 or 0…65535 | 2 |
| `'i'` / `'I'` | signed / unsigned 32-bit | 4 |
| `'f'` | single-precision float | 4 |

Pick the smallest one your values actually fit in — a servo pulse in
microseconds is `'H'`, a signed encoder delta is `'h'`, a gamma table is `'B'`.
An `array` indexes, slices and iterates exactly like the list it replaces, and
every driver that takes a buffer takes one.

This is a hint and stays a hint, because choosing the typecode is your call:
only you know whether the next value written into that table might be negative,
or bigger than 65535, or a float. Guess wrong on your behalf and the rewrite
turns a working program into an `OverflowError` at 3am. So the rule points at
the table, says how many numbers are in it, and leaves the choice with you.

Gated on a board being connected at all: it is advice about the RAM on the chip
in front of you, and Snakie says nothing about a board it cannot see.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
