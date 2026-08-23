This loop burns 100% CPU doing nothing — sleep in it, or wait on an interrupt.

```python
# before                        # after (one of several right answers)
while not ready:                while not ready:
    pass                            time.sleep_ms(1)
```

## Why it matters

`while not ready: pass` is a *busy-wait*. It does not wait —
it runs, flat out, executing the loop millions of times a second and doing
nothing with any of them. The costs are all real and all invisible until they
bite:

- **Power.** The CPU never idles, so a battery-powered robot that should sit
  quietly between readings instead runs at full draw. On a coin cell this is
  the difference between weeks and hours.
- **Heat and headroom.** Everything else on the board is now competing with a
  loop that has nothing to do.
- **The network stack.** On an ESP32 or a Pico W, WiFi and Bluetooth are
  serviced from the same core as your Python. A tight spin loop starves them,
  which shows up as dropped connections you will blame on the router.

There are three good answers and Snakie will not pick for you, because the
right one depends on what you are waiting *for*:

- **Sleep in the loop** — `time.sleep_ms(1)` inside the body. One line, and it
  hands the CPU back between checks. Almost always enough.
- **Wait on an interrupt** — if the thing you are waiting for is a pin, an
  `.irq()` handler means you do not poll at all.
- **`await` an `asyncio.Event`** — in async code this is the idiomatic answer,
  and it lets every other task run while you wait.

The empty-bodied form is also a genuine hang risk in its own right: if the
flag is only ever set by an interrupt that cannot fire while the loop holds
the CPU, the loop never exits at all.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
- This is flagged as a **warning** because it is a bug waiting to happen, not a style preference.
