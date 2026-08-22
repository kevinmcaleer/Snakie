This accumulator starts as a float but only ever gains whole numbers.

```python
# before                              # after (by hand)
def average_volts(samples):           def average_millivolts(samples):
    total = 0.0                           total_mv = 0
    for _ in range(samples):              for _ in range(samples):
        total += read_u16()                   total_mv += read_u16()
    return total / samples                return total_mv // samples
```

## Why it matters

The RP2040 has no floating-point unit, and neither do most of
the other chips MicroPython runs on. Every float operation is therefore a call
into a soft-float library — a routine that unpacks two mantissas, aligns the
exponents, does the arithmetic in integers anyway and packs the result back
up. On top of that each result is a *heap object*, so a loop accumulating into
a float allocates once per iteration and hands the garbage collector work it
did not need. Integer addition, by comparison, is one machine instruction on a
small int that never leaves the register.

The tell Snakie looks for is an accumulator that was *declared* a float —
`total = 0.0` — but only ever has whole numbers added to it. That is almost
always a habit picked up from desktop Python, where the `0.0` costs nothing
and saves you from integer division later. On a microcontroller it is paying
the soft-float tax on every single sample for no benefit at all.

**This is a trade, and an honest rule says so.** Keeping the sum in integers
usually means changing units — millivolts instead of volts, ticks instead of
millimetres, hundredths of a degree instead of degrees — and scaling once at
the end. That is faster and exact, but it does make the code read a little
further from the physical quantity, and it puts the burden of remembering the
scale on whoever reads it next. Worth it in a sampling loop; not worth it in a
function that runs twice.

So Snakie only points: it flags the accumulation, names the float that
started it, and lets the author decide. There is no mechanical rewrite,
because choosing the new unit is the entire job.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
