This driver object is rebuilt every iteration — create it once, before the loop.

```python
# before                            # after
def blink(count):                   def blink(count):
    for _ in range(count):              led = Pin(25, Pin.OUT)
        led = Pin(25, Pin.OUT)          for _ in range(count):
        led.value(1)                        led.value(1)
        sleep_ms(50)                        sleep_ms(50)
```

## Why it matters

a `Pin`, `PWM` or `I2C` object is not a value, it is a driver.
Rebuilding one every time round the loop allocates a fresh object on a heap
that has no room to spare, hands the collector work it did not need, and on
several ports re-runs the peripheral's *initialisation* — re-arming the pad,
resetting the PWM counter, dropping the line low for an instant. That is why
this one is a **warning** rather than a hint: people meet it as "my PWM
flickers" or "the bus randomly NAKs", and never think to look at the
constructor.

The rewrite is loop-invariant code motion, so it only fires when it can be
proved safe: the construction must be an unconditional statement of the loop
body, bound to a name the loop does not rebind, its arguments must not read
anything the loop writes, the name must not be read after the loop, and a
`while` must not test the name it builds. Anything less and we decline rather
than guess — a wrong rewrite here does not raise, it just makes the
hardware misbehave, which is the worst kind of wrong.

## Before you apply it

- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
