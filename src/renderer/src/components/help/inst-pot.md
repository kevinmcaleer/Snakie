A vintage **B.S. First Grade** moving-coil ammeter re-scaled to read a
**potentiometer** as **0–100 %** — plus a rotary knob mirroring how far the pot
is turned.

## What it shows
- The needle + swept brass band read the wiper as a percentage of full scale.
- The knob shows the turned position; the readout gives the % and the raw volts.
- **SRC** picks which reporting ADC channel to read (defaults to `pot`).

## Feed it
Stream the wiper voltage on the passive telemetry channel — either print a meter
reading, or bind the ADC object by name and let the type drive the panel:

```python
import instruments as inst
from machine import ADC, Pin

pot = ADC(Pin(26))          # wiper (OUT) on GP26
inst.watch(pot=pot)         # → SNK BIND pot adc (lights up this meter)
while True:
    inst.update()           # → SNK METER pot <volts>  → the needle
    inst.control.poll()
```

Percent is `volts / 3.3 × 100`. Average a few `read_u16()` samples upstream for a
steadier needle — a bare ADC read is a little jittery.
