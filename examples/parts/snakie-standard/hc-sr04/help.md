# HC-SR04 Ultrasonic Range Finder

An ultrasonic distance sensor: it pings a short burst of sound from one
transducer and times the echo back into the other. Good for roughly 2 cm–4 m —
obstacle avoidance, parking sensors, level gauges.

## Wiring

| Pin | Connect to |
|---------|------------|
| VCC | 3V3 (see ⚠️ below) |
| Trigger | any GPIO (e.g. **GP1**) |
| Echo | any GPIO (e.g. **GP0**) |
| GND | GND |

⚠️ Classic HC-SR04 boards are **5 V** parts. If yours is a 3.3 V variant (like
this one) wire VCC to **3V3** and you're done. If it needs 5 V, power it from
**VBUS/5 V** and put a **voltage divider** (e.g. 1 kΩ / 2 kΩ) on **Echo** — a
5 V echo pulse straight into a Pico GPIO can damage the pin.

## Quick start

```python
import machine
import time
from machine import Pin

trig = Pin(1, Pin.OUT)          # Trigger on GP1
echo = Pin(0, Pin.IN)           # Echo on GP0

def distance_cm():
    trig.low(); time.sleep_us(2)
    trig.high(); time.sleep_us(10)   # 10 µs ping
    trig.low()
    us = machine.time_pulse_us(echo, 1, 30000)  # wait for the echo
    return us * 0.0343 / 2           # speed of sound, there and back

while True:
    print(round(distance_cm(), 1), "cm")
    time.sleep(0.2)
```

## Tips

- **-1 or -2 readings** → `time_pulse_us` timed out: nothing in range (>4 m),
  or Trigger/Echo swapped.
- Soft or angled surfaces scatter the ping — readings get flaky; average a few
  samples for a steadier number.
- Leave ~60 ms between pings so a late echo doesn't bleed into the next reading.

## 3-D model

The model shown in the Robot View is the **HC-SR04** from the
[FreeCAD-library](https://github.com/FreeCAD/FreeCAD-library) (Electronics
Parts → Ultrasonic Sensors; CC-BY 3.0, credited to its contributors in that
repository's history). It is real-size in millimetres: the 45 × 20 mm board with
its two Ø16 mm transducers standing 11 mm proud of it and the right-angle header
pins hanging 3.5 mm below. The part carries the `meshOffset` that centres it and
rests those pins on the ground plane; the file itself is untouched. The STEP and
FreeCAD originals live in the same repository if you want to edit it.
