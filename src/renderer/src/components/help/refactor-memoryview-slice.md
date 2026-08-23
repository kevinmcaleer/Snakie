Slicing a bytearray copies it — a memoryview slice is a view, not an allocation.

```python
# before                                  # after (by hand)
rx = bytearray(128)                       rx = bytearray(128)
                                          view = memoryview(rx)
for _ in range(packets):                  for _ in range(packets):
    header = rx[offset:offset + 2]            header = view[offset:offset + 2]
    payload = rx[offset + 2:offset + 10]      payload = view[offset + 2:offset + 10]
```

## Why it matters

**slicing a `bytearray` copies.** `rx[0:2]` does not hand you a
window onto the two bytes already sitting in memory; it asks the heap for a
brand-new two-byte object and copies them in. Inside a loop that is a fresh
allocation every single iteration, for data you already have, in memory you
already own. Two slices per packet at 200 packets a second is 400 short-lived
objects a second, and every one of them is work for the garbage collector that
eventually stops your loop to sweep them up.

`memoryview(rx)` wraps the same buffer, and slicing the view is free:
`view[0:2]` is a *view*, not a copy. No allocation, no garbage, no collector
pause. Everything that reads bytes — `sum()`, `int.from_bytes()`,
`struct.unpack_from()`, `uart.write()` — takes a memoryview happily, because
they all speak the buffer protocol.

The one catch worth knowing: a memoryview **keeps the underlying buffer
alive**, and while any view exists you cannot resize the bytearray it points
at. So make the view where the buffer is made, use it, and do not hold one
longer than you need it.

This is a hint and stays a hint. Where the view should live — next to the
buffer, once, at import time — and which of the slices in a file should use it
are decisions about the shape of your program, not a substitution a tool can
make blind. So the rule points at the copy and explains, and changes nothing.

Gated on a board being connected at all: it is advice about the heap on the
chip in front of you, and Snakie says nothing about a board it cannot see.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
