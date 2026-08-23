This attribute chain is looked up every pass — bind it to a local first.

```python
# before                            # after
while True:                         duty = self.motor.duty_u16
    self.motor.duty_u16(left)       while True:
    self.motor.duty_u16(right)          duty(left)
                                        duty(right)
```

## Why it matters

`self.motor.duty_u16` is not a name, it is *work*. Every time
that expression is evaluated MicroPython looks `motor` up in the instance
dictionary, then looks `duty_u16` up in the object's type, then builds a bound
method object to hold the pair. Three dictionary probes and an allocation, on
every single pass of your control loop, to reach a function that was never
going to change.

Binding it to a local once, before the loop, turns all of that into a single
array index — locals are numbered slots the compiler resolves at compile time,
not names looked up at run time. This is the first thing the official
*Maximising MicroPython speed* guide tells you to do, and on a loop that ran
three attribute chains per pass it is routinely a double-digit percentage.

Snakie only points, because *where* to bind it is a judgement about your
program's shape. A local before the loop is the usual answer, but if the loop
is a method that runs often, `self._duty = self.motor.duty_u16` in `__init__`
is better, and if the object can be swapped at run time then caching it is
wrong and the lookup is the point.

One caveat worth knowing: this trades a little readability for speed, so it
belongs in the loop that is actually your bottleneck, not everywhere. Measure
first — the Benchmark button in the preview exists for exactly this argument.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
