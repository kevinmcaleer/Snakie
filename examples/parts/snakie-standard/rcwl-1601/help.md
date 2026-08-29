# RCWL-1601 Ultrasonic Distance Sensor

An ultrasonic range finder: it pings a burst of sound from one transducer and
times the echo back into the other. 2 cm to about 4 m — obstacle avoidance,
parking sensors, level gauges.

It is **pin- and software-compatible with the [HC-SR04](hc-sr04)**, so any code
or wiring diagram written for that part works unchanged. The reason to reach for
this one instead is the power rail.

## Why this one on a Pico

A classic HC-SR04 is a **5 V** part. On a 3.3 V board that means powering it
from VBUS and putting a **voltage divider on Echo**, because a 5 V echo pulse
straight into a Pico GPIO can damage the pin — a step that is easy to skip and
expensive to get wrong.

The RCWL-1601 is specified from **3.0 V to 5.5 V**. Run it from **3V3** and the
echo pulse comes back at 3.3 V. **No divider, no level shifter, nothing to get
wrong.** That is the whole point of the part, and it is why it suits a workshop
or a classroom.

Range is slightly shorter at 3.3 V (about 4 m, against 4.5 m at 5 V), which is
rarely the limiting factor on a small robot.

## Wiring

| Pin | Connect to |
|-----|------------|
| VCC | **3V3** |
| Trig | any GPIO (e.g. **GP1**) |
| Echo | any GPIO (e.g. **GP0**) |
| GND | GND |

The middle two pads carry extra silk — `Trig/SCL/Rx` and `Echo/Tx/SDA` — for the
I²C and serial modes some RCWL modules offer. In the ordinary ultrasonic mode
they are just Trig and Echo.

## Quick start

```python
import machine
import time
from machine import Pin

trig = Pin(1, Pin.OUT)          # Trig on GP1
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

No driver to install — `machine.time_pulse_us` is built into MicroPython.

## Tips

- **-1 or -2 readings** → `time_pulse_us` timed out: nothing in range, or Trig
  and Echo are swapped.
- Soft or angled surfaces scatter the ping, so readings get flaky. Average a few
  samples for a steadier number.
- Leave ~60 ms between pings so a late echo doesn't bleed into the next reading.
- The beam is about 15° wide, so it sees the *nearest* thing in a cone — not
  necessarily what is straight ahead.

## Links

- [Adafruit product page](https://www.adafruit.com/product/4007)
