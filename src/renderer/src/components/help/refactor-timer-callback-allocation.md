This timer callback allocates — on a hard-IRQ port that means MemoryError.

```python
def sample(timer):                   samples = bytearray(64)
    log.append([                     index = 0
        time.ticks_ms(),             def sample(timer):
        battery.read_u16()               global index
    ])                                   samples[index] = battery.read_u16() >> 8
                                         index = (index + 1) % len(samples)
Timer(period=10, callback=sample)    Timer(period=10, callback=sample)
```

A `machine.Timer` callback is a hard interrupt on several ports (the RP2040
and the ESP32 among them), so it obeys exactly the same rule as a pin ISR: no
allocation. Building a list every 10 ms is asking the allocator for memory
from interrupt context, and when the heap is momentarily busy MicroPython
answers `MemoryError: memory allocation failed` — usually hours into a run,
never on the bench.

It is the sneakier of the two, because the callback rarely *looks* like an
interrupt handler. It is an ordinary-looking `def` sitting next to ordinary
code, and the only clue is the `callback=` it was handed to.

Snakie only points at it, for the same reason it does with interrupt handlers: pre-allocating the buffers and
moving the formatting to `micropython.schedule()` is a design decision about
your data, not a mechanical rewrite.timer callback?" question.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
