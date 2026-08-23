This interrupt handler allocates — it will raise MemoryError on the robot.

```python
def on_tick(pin):                    ticks = 0
    events.append({                  def on_tick(pin):
        "us": time.ticks_us()            global ticks
    })                                   ticks += 1
                                         micropython.schedule(log_tick, ticks)
encoder.irq(handler=on_tick)         encoder.irq(handler=on_tick)
```

An interrupt handler runs with the heap locked. Building a dict, an f-string,
a list, or joining two strings with `+` all ask the allocator for memory, and
in interrupt context MicroPython answers with
`MemoryError: memory allocation failed`. Worse, it does so *only* once the
heap happens to be busy — so it passes on the bench all afternoon and fires at
3am with the robot halfway down a corridor.

The cure is a restructuring, not a substitution: pre-allocate the buffers at
import time, have the handler write integers into them, and hand the
formatting to `micropython.schedule()` so it runs back on the main thread.
That is a judgement call about *your* data, so Snakie only points at it — it
points at the allocation and explains, and never rewrites your ISR for you.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
