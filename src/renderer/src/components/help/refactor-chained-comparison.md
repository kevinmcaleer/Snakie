This is a range check — Python can write it as one chained comparison.

```python
if MIN_US < pulse and pulse < MAX_US:      if MIN_US < pulse < MAX_US:
    servo.duty_ns(pulse)                       servo.duty_ns(pulse)
```

Python is one of the few languages where the maths notation works, and a range
check written as a range reads as one idea instead of two joined by an `and`.
It also removes the classic copy-paste bug in the second half (`pulse < MAX_US`
typed as `pluse < MAX_US`, or the wrong variable entirely), because the middle
term is now written once.

Written once is also exactly why Snakie is careful here: `a < f() and f() < b`
calls `f()` **twice**, and `a < f() < b` calls it **once**. On a board that
might be an ADC read, an I²C transaction or a millisecond of timing, so unless
the shared middle term is a pure expression — a name, an attribute, arithmetic
over those — the rule declines and leaves the `and` alone. The same goes for
`a < b and b > c`: chaining it is legal Python but it no longer reads as a
range, so we don't offer it.
