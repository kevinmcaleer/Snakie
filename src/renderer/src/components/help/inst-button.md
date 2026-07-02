Watches a bank of digital inputs live, without touching the REPL.

## What it shows
One row per named button/switch with a lit **PRESSED / released** lamp and a **rising-edge counter** (press count). The bottom strip reads **BUTTONS / LAST / EDGES**. It's read-only: the panel has no pins to set — it just parses `SNK BTN <name> <0|1>` from the serial stream.

## How to use it
Wire your button to any `machine.Pin` input, then have your program print a reading each loop with `inst.button(name, state)` (state is coerced to 1 if truthy). The row appears the moment the first line arrives.

```python
from machine import Pin
import instruments as inst

btn = Pin(15, Pin.IN, Pin.PULL_UP)
while True:
    inst.button("A", not btn.value())  # pull-up: pressed = low
```
