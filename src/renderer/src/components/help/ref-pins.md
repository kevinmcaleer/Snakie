Every GPIO is a `machine.Pin`. Set a **direction** (in/out) when you make it, then `.value()` or `.on()/.off()` to use it.

## Output

```python
from machine import Pin

led = Pin(15, Pin.OUT)
led.on()          # 3.3 V (high)
led.off()         # 0 V (low)
led.toggle()
led.value(1)      # or 0
```

## Input & pull resistors

A floating input reads noise. Add an internal pull so an unconnected pin has a defined level.

```python
btn = Pin(14, Pin.IN, Pin.PULL_UP)
# wired to GND, so pressed == 0
if btn.value() == 0:
    print("pressed")
```

- `Pin.PULL_UP` — idles **high**, reads 0 when tied to GND
- `Pin.PULL_DOWN` — idles **low**
- `Pin("LED", Pin.OUT)` uses the onboard LED on many boards

## Notes

- Pin numbers are the **GPIO** number, not the physical pin. Check the pinout.
- GPIOs are **3.3 V** — don't feed them 5 V.
