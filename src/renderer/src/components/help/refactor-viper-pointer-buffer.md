Indexing a buffer element by element is the subscript protocol — viper can make it a raw load.

```python
# today                              # what viper makes possible
def brighten(step):                  @micropython.viper
    frame = bytearray(64)            def brighten(frame, step: int):
    for i in range(64):                  buf = ptr8(frame)
        frame[i] += step                 for i in range(64):
                                             buf[i] = buf[i] + step
```

## Why it matters

This is the single biggest win the viper emitter has to offer,
and it is the reason `ptr8`/`ptr16`/`ptr32` exist at all.

`frame[i]` is not one machine instruction. It is a full Python subscript: look
up the object's type, find its subscript slot, bounds-check the index, box the
result into an integer object, hand it back. Then `frame[i] = x` does the same
walk in reverse. Multiply by every pixel of a frame buffer, every byte of a
packet, every sample of an audio window, and the indexing costs more than the
arithmetic it is feeding.

Inside a viper function, `ptr8(frame)` casts the buffer to a raw byte pointer.
`ptr8(frame)[i]` then compiles to a single load instruction: no type lookup,
no object, no allocation. Pixel buffers, frame buffers and packet parsing are
exactly where that pays, and the difference is usually not subtle.

**`ptr8` has no bounds checking. None at all.** `buf[i]` raises `IndexError`
when `i` runs past the end; `ptr8(buf)[i]` reads whatever memory happens to be
at that address, and writing through it corrupts whatever was living there.
An off-by-one will not look like a bug in this function. It will look like the
board rebooting, or a different variable changing value on its own, or a hard
fault with a traceback pointing somewhere innocent. Hoist the length into a
local and check it yourself, because nothing else will.

Snakie is a hint and stays one. The rewrite is not a substitution: the
enclosing function has to become a viper function first (rule 44), the buffer
has to be reachable as a parameter or a local, and you have to decide where
the bounds check now lives. Pointing at the loop and explaining the prize is
the honest move; silently turning your frame buffer into an unchecked pointer
is not.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
