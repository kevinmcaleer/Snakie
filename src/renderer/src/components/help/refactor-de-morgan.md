This negated group reads better with the `not` pushed inwards.

```python
# before
if not (speed == 0 and distance_cm > DEAD_ZONE_CM):
    stop()

# after
if speed != 0 or distance_cm <= DEAD_ZONE_CM:
    stop()
```

A negated group makes the reader hold the whole bracket in their head and
then flip it. Pushing the `not` inwards — `not (a and b)` is `not a or not b`
— lets them read the condition left to right, and it is the step that turns
a tangled `if` into one a guard clause ("Convert to guard clause") can invert cleanly.

We only offer it where the result is genuinely tidier: every operand has to
invert into something a person would have written by hand (`>` → `<=`,
`is` → `is not`, `not x` → `x`). A half-inverted
`not armed or not (sensor.ready and calibrated)` is harder to read than the
bracket it replaced, so that case is left alone. Chained comparisons
(`0 < value < 100`) never qualify — their negation is emphatically not
`0 >= value >= 100`.
