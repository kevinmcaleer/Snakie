A bare address says nothing — pull it into a named const().

```python
# before                                # after (by hand)
import machine                          from micropython import const
                                        import machine
def pulse(count):
    for _ in range(count):              SIO_GPIO_OUT_XOR = const(0xD000001C)
        machine.mem32[0xD000001C] = 1 << 25   LED_MASK = const(1 << 25)

                                        def pulse(count):
                                            for _ in range(count):
                                                machine.mem32[SIO_GPIO_OUT_XOR] = LED_MASK
```

## Why it matters

`mem32[0xD000001C]` tells the next reader nothing. It does not
say which peripheral, which register, or what the write is supposed to do —
and in six months, when you come back to work out why the encoder stopped, it
will not tell *you* either. `SIO_GPIO_OUT_XOR` says all three, and it is the
name printed in the datasheet, so a reader can look it up. Register banging is
already the least forgiving code in the file; the least it can do is say what
it is touching.

There is a second, quieter reason to use `const()` rather than a plain
assignment. `SIO = 0xD0000000` creates a module-level global: the compiler
emits a dictionary lookup at every use, and the value sits in RAM for the life
of the program. `SIO = const(0xD0000000)` is substituted **at compile time** —
the number is baked straight into the bytecode, there is no global, no lookup
and no RAM cost. On the hot path where you are hand-writing register accesses,
that is exactly the trade you wanted.

```python
from micropython import const

SIO_BASE = const(0xD0000000)
GPIO_OUT = const(SIO_BASE + 0x10)   # const() folds this too
```

A name that starts with an underscore goes further: MicroPython drops
`_PRIVATE = const(…)` from the module's globals dict entirely once it has been
folded, so it costs nothing at all.

This is a hint and stays a hint. Only you know which register `0x4001C00C` is
— the rule can see that a bare address is being poked, but inventing a name
for it would mean inventing the datasheet, and a *wrong* name is far worse
than a bare number. So it points at the address and leaves the naming to you.

**Note what Snakie does not do:** it says nothing about which chip you are
on, and it never infers an architecture from the address. Two boards can put
completely different peripherals at the same number.

Gated on a board being connected at all — this is advice about the silicon in
front of you, and Snakie says nothing about a board it cannot see.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
