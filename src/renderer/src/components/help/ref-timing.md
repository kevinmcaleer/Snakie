Use the `time` module to pause and to measure elapsed time.

## Delays

```python
import time

time.sleep(1)        # seconds (float ok: 0.25)
time.sleep_ms(250)   # milliseconds
time.sleep_us(500)   # microseconds
```

`sleep_ms` / `sleep_us` are MicroPython extras — handy for short, exact pauses.

## Measuring time

`ticks_ms()` is a free-running millisecond counter. Always compare with `ticks_diff` (it handles wrap-around correctly — don't subtract directly).

```python
start = time.ticks_ms()
# ... do work ...
elapsed = time.ticks_diff(time.ticks_ms(), start)
print(elapsed, "ms")
```

## Non-blocking timing

Avoid `sleep` in loops that must stay responsive — poll instead:

```python
next_t = time.ticks_ms()
while True:
    if time.ticks_diff(time.ticks_ms(), next_t) >= 0:
        next_t = time.ticks_add(next_t, 500)
        led.toggle()   # every 500 ms
```
