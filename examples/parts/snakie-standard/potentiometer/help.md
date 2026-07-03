---
kevsrobots: https://www.kevsrobots.com/learn/parts/potentiometer/
example: potentiometer_read.py
---
# Potentiometer

A **potentiometer** ("pot") is a rotary variable resistor. Wire the two outer
pins to **3V3** (VCC) and **GND**, and the middle **wiper** (OUT) to an **ADC**
pin — turning the knob sweeps the wiper voltage from 0 V to 3.3 V.

## Wiring

| Pin | Connect to |
|-----|------------|
| VCC | 3V3 |
| OUT | an ADC-capable GPIO (Pico: **GP26 / GP27 / GP28**) |
| GND | GND |

## Read it in MicroPython

```python
from machine import ADC, Pin
import time

pot = ADC(Pin(26))            # OUT wired to GP26 (ADC0)
while True:
    raw = pot.read_u16()      # 0 … 65535
    pct = raw * 100 // 65535  # 0 … 100 %
    volts = raw / 65535 * 3.3
    print(pct, "%", round(volts, 2), "V")
    time.sleep(0.1)
```

## See it on the Potentiometer instrument

Open the **Potentiometer** instrument (a vintage 0–100 % ammeter) and stream the
value with the Snakie library — no polling, works inside your loop:

```python
import instruments as inst
from machine import ADC, Pin

pot = ADC(Pin(26))
inst.watch(pot=pot)           # the dial + knob follow it by type
while True:
    inst.update()             # SNK METER pot <volts> → the meter needle
    inst.control.poll()
```

Only three ADC channels exist on the Pico (GP26–28), and the reading is a little
noisy — average a few samples for a steadier needle.
