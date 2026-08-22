`struct.pack()` allocates a new bytes object every time round the loop.

```python
# before                                  # after (by hand)
def stream(n):                            frame = bytearray(8)
    for i in range(n):                    def stream(n):
        link.write(                           for i in range(n):
            struct.pack("<Hhhh", i, *imu())       struct.pack_into(
        )                                             "<Hhhh", frame, 0, i, *imu())
                                                  link.write(frame)
```

## Why it matters

`struct.pack()` **returns a new `bytes` object**. Every call
asks the allocator for memory, and every result becomes garbage as soon as it
has been written. Do that once and nobody notices; do it two hundred times a
second in a sampling loop and the heap fills with short-lived objects until
the garbage collector stops the world to sweep them up. On a Pico that pause
is measured in milliseconds — long enough to miss an encoder edge, drop a
sample, or make a 200 Hz loop stutter in a way that looks like a hardware
fault and is not.

`struct.pack_into(fmt, buffer, offset, *values)` writes the same bytes
*into a `bytearray` you allocated once*, before the loop started. Same
format string, same output, no allocation, no garbage, no collector pause.
It is the single cheapest fix in the catalogue for a loop that stalls.

This one is `hintOnly`. Turning `pack` into `pack_into` means choosing where
the buffer lives, how big it is, what offset each write lands at, and whether
anything downstream held on to the old `bytes` object — decisions about your
framing that a rewrite cannot make for you. So the rule points at the call and
explains, and leaves the code exactly as it found it.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
