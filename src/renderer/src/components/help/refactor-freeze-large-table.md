A module-level table this size is a real fraction of your free heap.

```python
# A 256-entry gamma table at module scope…
GAMMA = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, ...]

# …on a board reporting 41 KB free is a meaningful fraction of what is left.
```

## Why it matters

A literal at module scope is *built at import time* and stays
on the heap for as long as the program runs. On a desktop nobody notices. On a
board with 41 KB free, a 256-element list of small integers is roughly 2 KB of
pointers plus the boxed integers behind them — and it is there whether or not
the program is currently using it.

This is the same smell as the plain large-table hint, escalated because Snakie
has *asked your board* how much heap is actually left and the answer was not
much. That is the difference between "this is a bit big" and "this is a bit
big and you have 41 KB" — the second is actionable and the first is noise,
which is why this one waits for a real measurement before it speaks.

Three ways out, roughly in order of effort:

- **`bytes` instead of a list.** If every value fits in a byte, `b'\x00\x01…'`
  is one object of exactly N bytes with no per-element boxing. Indexing it
  gives you an `int` back, so most code needs no other change.
- **`array.array`** for wider values — 2 or 4 bytes each, still unboxed.
- **Move it out of RAM entirely** — read it from a file on demand, or freeze
  the module into the firmware as frozen bytecode, where the table lives in
  flash and is never copied to the heap at all.

Snakie only points, because which of those is right depends on what the values
mean and how often you read them, and getting that wrong trades a memory
problem for a speed one.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
