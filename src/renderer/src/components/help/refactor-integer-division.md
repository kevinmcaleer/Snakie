`int(a / b)` divides in floats and then throws the fraction away — `//` stays in integers.

```python
# before                                 # after
revs = int(distance_mm / CIRCUM_MM)      revs = distance_mm // CIRCUM_MM
middle = int((left + right) / 2)         middle = (left + right) // 2
cell = histogram[int(reading / band)]    cell = histogram[reading // band]
```

## Why it matters

In Python 3 a single `/` *always* yields a float, even when
both operands are whole numbers. Most MicroPython targets — the RP2040
certainly — have no floating-point unit, so that one slash costs a soft-float
library call plus a freshly allocated float object on a heap that has nothing
to spare, and then `int()` throws the fraction away again. `//` never leaves
integer arithmetic: no allocation, no soft-float routine, and it states the
intent instead of hiding it behind a conversion.

**The caveat, and it is a real one.** These are not the same function.
`int()` truncates *towards zero*; `//` *floors*. They agree on every
non-negative value and disagree the moment a negative one turns up:
`int(-7 / 2)` is `-3`, but `-7 // 2` is `-4`. For encoder counts, buffer
indices and byte offsets that never happens; for a signed motor error or a
sub-zero temperature it certainly can.

Rather than guess which kind of number flows through a given expression — a
guess we could only ever get half right — the rule offers the rewrite every
time and says so plainly. That is why it is `a judgement call`: it stays out of
"Tidy this file" (R7), and the negative-number warning is repeated in the
preview message so nobody accepts it unread.

The rewrite itself is exact. `//` sits at the same precedence and
associativity as `/`, so both operands can be spliced across verbatim, and the
only judgement is whether the *surrounding* expression needs the result
wrapped — `-int(x / 2)` must become `-(x // 2)`, never `-x // 2`.

## Before you apply it

- Snakie can make this change, but it is a judgement call rather than a guaranteed-equivalent rewrite — read the diff before you accept it.
