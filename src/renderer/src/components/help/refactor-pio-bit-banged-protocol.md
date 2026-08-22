This looks like SPI written by hand — the chip probably has it in silicon.

```python
# before — shifting a byte out MSB-first, by hand
for i in range(8):
    data.value((byte >> (7 - i)) & 1)
    clock.value(1)
    clock.value(0)
```

## Why it matters

This is SPI. Somebody has written, in Python, the thing the
chip already has a dedicated peripheral for — and the Python version is
perhaps a hundred times slower, holds the CPU for the whole transfer, and has
timing that wanders whenever the garbage collector runs.

So the first question is not "how do I make this faster?", it is **"is this
already in hardware?"** Very often it is:

- **`machine.SPI`** for a clock-and-data shift like the one above. It is
  available on specific pins — check your board's pinout, because the
  peripheral is wired to particular GPIOs and moving to them is usually a
  two-wire change on the breadboard for an enormous win.
- **`machine.I2C`** if there is an addressed device and an acknowledge bit.
- **`machine.UART`** if it is start-bit, eight data bits, stop-bit.

Only if the protocol genuinely is not one of those — an unusual frame, a
non-standard clock polarity, a one-wire sensor like the DHT22 or DS18B20 — is
PIO the answer. A state machine will clock it exactly, at zero CPU cost, and
it is the reason the RP2040 has PIO at all.

Snakie deliberately points rather than rewrites. Moving to a hardware
peripheral means moving wires, and a refactoring tool that silently rewrote
your driver to use pins nothing is plugged into would be worse than useless.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
