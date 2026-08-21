CircuitPython's `time` is the standard Python one: **seconds, as floats**. There
is no `sleep_ms`, and no `ticks_ms`.

## Waiting

```python
import time

time.sleep(0.5)      # half a second
time.sleep(1)        # one second
time.sleep(0.001)    # a millisecond
```

`time.sleep_ms(500)` raises `AttributeError` here — divide by 1000 and use
`sleep()`.

## Measuring

```python
import time

start = time.monotonic()
do_something()
print(time.monotonic() - start, "seconds")
```

`monotonic()` counts seconds since boot and never goes backwards (unlike a wall
clock). It's a float, so after a few days of uptime it loses resolution — use
`time.monotonic_ns()`, an integer of nanoseconds, if that matters.

## Doing something every N seconds without blocking

`sleep()` stops everything. For a loop that keeps responding, compare the clock
instead:

```python
import time

next_blink = time.monotonic()
while True:
    now = time.monotonic()
    if now >= next_blink:
        next_blink = now + 0.5
        toggle_led()
    check_buttons()      # keeps running while we wait
```

## Notes

- `supervisor.ticks_ms()` exists and is a wrapping millisecond counter, the
  nearest thing to MicroPython's `ticks_ms()` — but `time.monotonic()` is the
  idiomatic choice and doesn't wrap.
- For several things at once, `asyncio` from the Adafruit bundle gives you
  `await asyncio.sleep(0.5)` per task.
- There's no `time.ticks_diff()`; plain subtraction is correct because
  `monotonic()` doesn't wrap.
