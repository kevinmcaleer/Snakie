This loop bit-bangs a timed pulse train — a PIO state machine clocks it in hardware.

```python
# before — the bit pattern timed in Python    # after — clocked by hardware
for colour in pixels:                         import neopixel
    for bit in range(24):                     np = neopixel.NeoPixel(data, 8)
        data.value(1)                         np[0] = (32, 0, 0)
        sleep_us(1)                           np.write()
        data.value(0)
        sleep_us(1)
        colour <<= 1
```

## Why it matters

A WS2812 reads a bit as "how long was the line high?", and the
two answers it accepts are about 0.4 µs and about 0.8 µs, with a tolerance of
roughly ±150 ns. A Python loop cannot hold that. Between two statements the
interpreter may dispatch bytecode, service an interrupt, or start a garbage
collection — jitter that is measured in tens or hundreds of microseconds,
which is not a slightly wrong bit period but hundreds of bit periods. That is
the real cause of the symptom everyone tries to fix by nudging the sleep
values: the first pixel is right, the rest are the wrong colour, and the whole
strip flickers when anything else on the board wakes up. No amount of tuning
fixes it, because the number you are tuning is not the number that varies.

The RP2040 and RP2350 have a peripheral built for exactly this. A PIO state
machine runs its own tiny program at a clock you choose, cycle-exact, with the
CPU not involved at all — so the timing does not care what the rest of your
program is doing. Two ready-made starting points beat writing one from
scratch: MicroPython ships a stock `asm_pio` WS2812 example (it is in the
`rp2` examples, about a dozen instructions), and the built-in `neopixel`
module wraps the whole thing behind `np[i] = (r, g, b)` and `np.write()`. Take
either one and delete the sleeps.

Deliberately narrow. "A loop that writes a pin and sleeps" also describes a
stepper pulse train and a piezo buzzer, and telling someone their buzzer is a
broken NeoPixel driver is exactly the sort of wrong hint that costs trust. So
this fires only when the loop is timing something a Python loop demonstrably
cannot time — a sub-10 µs literal delay — or when the code says in its own
names and comments that it is driving WS2812s.

Hint only: the fix is "use a different driver", not a text substitution, so
Snakie explains and links, and never rewrites your loop.

Gated on `caps.pio`, so it is offered only when the connected board really has
a PIO block. On an ESP32 the advice would be wrong, and with no board attached
Snakie says nothing at all.

## Before you apply it

- Snakie points this out but does **not** rewrite it for you — the right fix depends on what your program is for.
