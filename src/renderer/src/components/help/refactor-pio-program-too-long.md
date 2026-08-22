A PIO block holds 32 instructions, and this program is longer than that.

```python
# before — 43 instructions, one per phase # after — the table lives in RAM
@rp2.asm_pio(set_init=(PIO.OUT_LOW,) * 4) @rp2.asm_pio(out_init=(PIO.OUT_LOW,) * 4)
def half_step():                          def half_step():
    label("forward")                          wrap_target()
    set(pins, 0b0001)                         pull(block)
    nop()[31]                                 out(pins, 4)
    set(pins, 0b0011)                         wrap()
    nop()[31]
    …38 more…                             # the eight phases are a bytes()
                                          # object the CPU feeds to the FIFO
```

## Why it matters

This one is not a style opinion — it genuinely will not load.

A PIO block has exactly **32 instruction slots**, and they are shared by all
four state machines in that block. Your program is assembled and copied into
those slots when you construct the `StateMachine`, so a 43-instruction program
cannot be loaded at all, and a 20-instruction one leaves only 12 slots for
every other program in the same block. The error, when it comes, is a
run-time `OSError`/`ValueError` from the constructor rather than anything the
assembler said while you were writing — which is why a rule that counts as you
type earns its keep.

Getting under the limit is nearly always about moving data out of the program.
A PIO program is a *shape*, not a script: the eight phases of a half-step
sequence, the pulse widths, the bit patterns are data, and data belongs in the
FIFO where `pull()`/`out()` can stream it. Two directions written out longhand
become one loop reading a direction flag off the FIFO. Repeated `nop()[31]`
padding becomes one delay driven by a value the CPU pushes. And `label()`,
`wrap()` and `wrap_target()` are free — they are assembler directives that
mark positions, not instructions — so relabelling costs you nothing.

Hint only, and reported as an **error** rather than a hint: there is no
mechanical rewrite that shortens an assembly program without changing what it
does, but there is also no version of this that works.

Gated on `caps.pio`: on a board with no PIO block the program is not going to
be loaded either way, and Snakie says nothing when no board is connected.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
