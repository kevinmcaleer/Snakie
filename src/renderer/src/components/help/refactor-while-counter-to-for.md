A hand-counted `while` — `for i in range(...)` keeps the counter honest.

```python
i = 0                              for i in range(steps):
while i < steps:                       servo.angle(i * 2)
    servo.angle(i * 2)                 time.sleep_ms(20)
    time.sleep_ms(20)
    i += 1
```

The hand-rolled counter is three separate promises the reader has to check:
that it starts at zero, that the test is the right way round, and that the
increment is reached on *every* path through the body. Forget the last one and
the robot sits there spinning forever with the motors on. `range` makes all
three the language's problem.

Two things make this rewrite subtler than it looks, and both are worth
teaching:

1. **The counter's leftover value differs.** After the `while`, `i == steps`
   (that is why the loop stopped). After the `for`, `i == steps - 1` — and if
   `steps` was zero or less, `i` is never bound at all. So we decline the whole
   rewrite whenever `i` is still read after the loop.
2. **A `continue` skips the increment.** In the `while` form a `continue`
   jumps straight back to the test without ever reaching `i += 1`, which is
   either an infinite loop or a deliberate re-try. `for` would advance anyway,
   so we never touch a body containing one.

We also insist the bound is a pure expression the body never assigns to.
`while i < len(queue)` re-reads the length every single time round;
`range(len(queue))` reads it once, and a body that adds to `queue` would then
behave differently — as would `while i < self.count` over a body that winds
`self.count` down.
