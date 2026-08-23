An empty container is already falsy — this `len()` call says it twice.

```python
if len(samples) > 0:        if samples:
    flush(samples)              flush(samples)

while len(queue) == 0:      while not queue:
    sleep_ms(10)                sleep_ms(10)
```

Every built-in container is already falsy when it is empty, so counting its
items to ask "is there anything in here?" says the quiet part twice. The short
form is the idiom the MicroPython docs and every library use, it reads as the
question actually being asked, and it costs one truth test instead of a global
lookup plus a call — which on a Pico's inner loop is measurable.

The rewrite fires **only where the value is used as a condition**. `n =
len(xs) > 0` stores a bool where `n = xs` stores the list: outside a condition
those are different programs, so the rule declines rather than guess which one
was meant.
