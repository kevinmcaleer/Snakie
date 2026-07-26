# Grove Ultrasonic Ranger

Ultrasonic time-of-flight distance sensor, 2 cm to 350 cm, on a Grove **digital**
port.

## One wire does both jobs

This is the important difference from an HC-SR04: the Grove Ultrasonic Ranger has
a **single `SIG` line that is both trigger and echo**. You pulse the pin as an
output, then immediately flip it to an input and time the reply. HC-SR04 code
with separate `TRIG` and `ECHO` pins will not work here, and the two parts are
not interchangeable.

```python
from machine import Pin, time_pulse_us
import time

SIG = 26            # whichever GPIO the Grove digital port lands on

def distance_cm():
    p = Pin(SIG, Pin.OUT)
    p.low();  time.sleep_us(2)
    p.high(); time.sleep_us(10)
    p.low()
    p = Pin(SIG, Pin.IN)                 # same pin, now listening
    us = time_pulse_us(p, 1, 30000)      # 30 ms ~= 5 m of flight time
    return -1 if us < 0 else (us / 29.1) / 2
```

`time_pulse_us` returns a negative value on timeout — treat that as "nothing in
range" rather than letting it become a bogus distance.

## Making the readings usable

- **Don't poll faster than ~20 Hz.** Echoes from the previous ping are still
  bouncing around; you'll read the last one.
- **Take a median of 3.** Single ultrasonic readings drop out regularly against
  soft or angled surfaces. A median kills the outliers without the lag of an
  average.
- **Soft things are invisible.** Curtains, cushions and cats absorb the ping. A
  clean "no reading" is not the same as "nothing there".
- The beam is a **15° cone**, not a ray — it sees the nearest thing anywhere in
  that cone, which is usually the floor if you mount it pointing slightly down.
