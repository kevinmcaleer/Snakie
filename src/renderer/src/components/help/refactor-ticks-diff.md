Tick counters wrap — subtracting them directly breaks the timer.

```python
# before                              # after
start = ticks_ms()                    start = ticks_ms()
while ticks_ms() - start < 500:       while ticks_diff(ticks_ms(), start) < 500:
    poll_sensors()                        poll_sensors()
```

## Why it matters

**tick counters wrap.** `ticks_ms()` and friends do not return
a time, they return a counter that counts up to a port-defined ceiling and then
starts again from zero — on many ports `ticks_us()` wraps roughly every 17
minutes and `ticks_ms()` roughly every 12 days. Subtracting two of them with a
plain `-` is only right while no wrap falls between the two readings. When one
does, the subtraction goes hugely negative, and the timer built on it either
fires on every single pass forever or never fires again — a robot that stops
responding, or a "debounce" that stops debouncing.

`ticks_diff(new, old)` exists precisely for this: it is defined to compute the
signed difference correctly across the wrap. It is also the only supported way
to compare two tick values at all — the MicroPython docs are explicit that the
values are opaque and arithmetic on them is not portable.

This is a latent field bug, not a style nit: it cannot show up on the bench,
because the bench session is shorter than the wrap.

The rewrite keeps whichever spelling the file already uses — `time.ticks_ms()`
becomes `time.ticks_diff(…)`, a bare `ticks_ms()` becomes a bare
`ticks_diff(…)` — and when the bare form is used but `ticks_diff` was never
imported it is added to the `from time import …` line the tick function itself
came from. If the file already means something else by the name `ticks_diff`,
or the bare name cannot be traced to a `time`/`utime` import at all, Snakie declines: the warning still stands, but we will not call a function we cannot
prove exists.

## Before you apply it

- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
