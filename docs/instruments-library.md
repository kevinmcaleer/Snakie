# Instruments library — live readings for the Oscilloscope, Multimeter & Plotter

Snakie's **Oscilloscope**, **Multimeter** and **Plotter** can read live values
two ways:

1. **LIVE poll** (the toggle on a scope/meter) — Snakie reaches into the board
   over the raw REPL and reads each pin. This is fine when nothing is running,
   but it **interrupts a running program** on every poll.
2. **Telemetry** (this library, issue #107) — your program **prints** readings
   and Snakie **parses the serial stream**. This is passive, always-on, and does
   **not** interrupt anything, so it works inside a `while True:` loop.

The instruments library is the easy way to do (2): a handful of one-line helpers
that print the readings in a format Snakie recognises, routes to the right
instrument, and hides from the console.

## Copying the library to your board

Copy [`micropython/instruments.py`](../micropython/instruments.py) onto the
board's filesystem, alongside your `main.py` (e.g. drag it across in Snakie's
file view, or use `mpremote cp`/Thonny). Then `import` it from your program:

```python
import instruments as inst
```

It's pure MicroPython with no dependencies — safe to run on a Pico.

## Quick start

```python
import time
from machine import ADC, PWM, Pin
import instruments as inst

pwm = PWM(Pin(0)); pwm.freq(1000); pwm.duty_u16(32768)
adc = ADC(26)

while True:
    inst.read_pwm(pwm, ch="pwm")     # -> Oscilloscope (the PWM duty waveform)
    inst.read_adc(adc, ch="adc0")    # -> Multimeter (the ADC voltage)
    inst.plot(temp=21.4, light=80)   # -> Plotter (named series over time)
    time.sleep(0.1)
```

Open the matching instrument in Snakie (the **SCOPE** / **METER** dock buttons,
or a launcher in the Board View) and run the program — the instruments update
live while the loop runs, with **no LIVE toggle needed**. There's a runnable
demo in [`examples/instruments_demo.py`](../examples/instruments_demo.py).

## API

| Function | Emits | Notes |
| --- | --- | --- |
| `scope(value, ch="ch1")` | one oscilloscope sample | call repeatedly in a loop → a live waveform |
| `meter(value, ch="adc0", unit="V")` | one meter reading | the latest value is shown; Snakie tracks MIN/MAX/AVG |
| `plot(*args, **kwargs)` | one plotter row | bare numbers and/or `name=value` series |
| `read_adc(adc, ch="adc0")` | a meter reading, returns volts | reads `adc.read_u16()`, converts to volts (3.3 V ref, 16-bit) |
| `read_pwm(pwm, ch="pwm")` | a scope sample, returns duty | reads `pwm.duty_u16() / 65535` |

`plot` mixes styles: `plot(1, 2, 3)` graphs three positional series, while
`plot(temp=21.4, light=80)` graphs named ones; you can combine them.

### The channel label `ch`

`<ch>` is a label you choose (e.g. `pwm`, `adc0`, the variable name). Snakie uses
it to match a reading to an open instrument:

- If the label matches the instrument's source variable, that reading feeds it.
- If only **one** scope (or meter) is open, it gets the telemetry regardless of
  the label — so the simple "open one scope and print" case just works.

## The telemetry protocol

Each helper does a **single `print()`** of **one line**, prefixed with the
sentinel token `SNK`. One reading per line, ASCII, space-delimited:

```
SNK SCOPE <ch> <value>            # a scope sample (value: float)
SNK METER <ch> <value> [<unit>]   # a meter reading (default unit "V")
SNK PLOT  <tok> [<tok> ...]       # plotter data; each tok is name=value or a number
```

Examples of the exact lines printed:

```
SNK SCOPE pwm 0.5
SNK METER adc0 1.65 V
SNK PLOT temp=21.4 light=80
SNK PLOT 1 2 3
```

The `SNK` sentinel does three jobs in the IDE:

- **Routes** the line to the scope, meter or plotter.
- **Hides** the line from the REPL console (it's machine data, not output).
- Makes the Plotter's generic number parser **ignore** scope/meter lines (only
  `SNK PLOT` rows are graphed; plain non-`SNK` prints still graph as before).

Because the helpers are just `str` formatting plus one `print`, they're cheap and
non-blocking — safe to call at speed inside a tight loop.

## A worked loop example

```python
import time
from machine import ADC, PWM, Pin
import instruments as inst

pwm = PWM(Pin(0)); pwm.freq(1000)
adc = ADC(26)

duty = 0
while True:
    duty = (duty + 2048) & 0xFFFF      # sweep the PWM duty
    pwm.duty_u16(duty)

    d = inst.read_pwm(pwm, ch="pwm")    # scope: the duty fraction (0..1)
    v = inst.read_adc(adc, ch="adc0")   # meter: the ADC voltage
    inst.plot(duty=round(d, 3), volts=round(v, 3))  # plotter: both over time

    time.sleep(0.05)
```

Open the Oscilloscope, Multimeter and Plotter, run this, and watch all three
update together — without interrupting the loop.

## See also

- [`docs/board.md`](board.md) — the Board View and its scope/meter launchers.
- [`micropython/instruments.py`](../micropython/instruments.py) — the library.
- [`examples/instruments_demo.py`](../examples/instruments_demo.py) — runnable demo.
