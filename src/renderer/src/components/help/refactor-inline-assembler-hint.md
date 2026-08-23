This viper leaf is as fast as Python source gets — the next rung is inline assembly.

```python
@micropython.viper
def crc16(seed: int, data: int) -> int:
    crc = seed ^ (data << 8)
    for _ in range(8):
        if crc & 0x8000:
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF
        else:
            crc = (crc << 1) & 0xFFFF
    return crc
```

## Why it matters

This function has already been through the whole optimisation
ladder. It is a leaf — it calls nothing else in the file — it is integer work,
and it is already carrying `@micropython.viper`, which is the fastest thing
MicroPython can generate from Python source. If it is *still* the bottleneck,
there is exactly one rung left: write the loop in the chip's own instructions
with an inline-assembler decorator.

Snakie will not write that for you, and Snakie never rewrites anything. It
exists to tell you the rung is there, and what standing on it costs:

- **At most four arguments**, and every one of them a machine word. There is
  no argument tuple, no keywords, no defaults.
- **The result comes back in the first register of the calling convention**
  (`r0` on Arm Thumb). One value, one machine word, no return of an object.
- **No Python objects at all.** Not a list, not a string, not an exception.
  You get registers, the memory you were handed a pointer to, and the
  instruction set. A stray object reference is not slow, it is a crash.
- **You are writing for one chip.** The function stops being portable in a way
  nothing else in this catalogue does: move the same file to a different board
  and it will not even import.

That last point is why the hint names the assembler **your board reported**,
never one guessed from the chip's name. An RP2350 boots as either an Arm
Cortex-M33 or a RISC-V Hazard3 depending on how it was flashed, and the same
silicon therefore wants `asm_thumb` or `asm_rv32` on different days. Snakie
asks the firmware, and if the firmware does not offer an inline assembler at
all Snakie says nothing.

To learn the syntax, look up "inline assembler" in the MicroPython
documentation — it lives in the language-reference section, one page per
architecture, listing the exact subset of instructions the compiler accepts.
Read the page for the architecture named in the hint, not the Thumb one by
default.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
