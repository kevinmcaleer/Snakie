A fractional `sleep()` costs a float and is not portable — `sleep_ms()` is.

```python
# before                        # after
led.on()                        led.on()
time.sleep(0.1)                 time.sleep_ms(100)
led.off()                       led.off()
time.sleep(0.25)                time.sleep_ms(250)
```

## Why it matters

`0.1` is a *float*, and on a microcontroller a float is not
free. Most MicroPython targets have no floating-point unit, so every float is
a heap-allocated object and every sum on it is a software routine — and
`time.sleep()` then has to convert it back into the integer milliseconds the
scheduler actually wants. `sleep_ms(100)` skips all of that: one small int, no
allocation, no soft-float maths.

Portability is the sharper edge. The MicroPython docs are explicit that
`time.sleep()` with a *fractional* argument is not supported on every port —
on some it truncates to whole seconds, so `sleep(0.1)` becomes `sleep(0)` and
a carefully paced motor ramp turns into a blur. `sleep_ms()` and `sleep_us()`
are the portable spelling and exist everywhere MicroPython does.

And it reads better: `sleep_ms(250)` states the unit that the rest of the file
is already using for its timeouts and periods.

The rewrite is deliberately narrow. It fires only on a float literal that is a
whole number of milliseconds — `0.0005` is 500 µs and `sleep_us()` is the
right answer there, which is a different call with a different argument, so we
leave it alone. An integer `sleep(1)` is left alone too: it costs one small
int either way and reads perfectly well as seconds. A bare `sleep(…)` is only
touched when it can be traced to a `from time import sleep` — `asyncio` binds
a coroutine to exactly that name, and rewriting *that* would be a disaster.
