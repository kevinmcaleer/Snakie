# N20 Motor

A tiny **6 V brushed DC gear motor** in the classic N20 metal-gearbox package —
small, quiet, and torquey for its size. A favourite for micro robots, line
followers, and anything on wheels.

## Wiring

| Pin | Connect to |
|-----|------------|
| VCC | motor driver **output** (e.g. MX1508 / DRV8833 OUT1) |
| GND | motor driver **output** (e.g. OUT2) |

⚠️ **Never wire a motor straight to a GPIO pin.** A GPIO supplies a few
milliamps; a motor wants hundreds. Drive it through an H-bridge (MX1508,
DRV8833, L298N…) powered from its own **6 V** supply, with GND shared with the
Pico.

⚠️ The two terminals aren't really "+" and "−" — swapping them just reverses
the spin direction. That's how the H-bridge reverses it too.

## Quick start

Via an H-bridge with its two inputs on **GP2** and **GP3** — PWM one input to
set the speed, swap which input gets the PWM to reverse:

```python
from machine import Pin, PWM
import time

in1 = PWM(Pin(2), freq=1000)
in2 = PWM(Pin(3), freq=1000)

def drive(speed):                 # -100 … +100 %
    duty = int(abs(speed) * 65535 / 100)
    in1.duty_u16(duty if speed > 0 else 0)
    in2.duty_u16(duty if speed < 0 else 0)

drive(75)          # forward at 75 %
time.sleep(2)
drive(-75)         # reverse
time.sleep(2)
drive(0)           # stop
```

## Tips

- Below ~30 % duty the gearbox may stall — start higher, then ease down.
- Solder a small **ceramic capacitor** across the terminals to tame electrical
  noise if your board resets when the motor kicks in.
- Gear ratios vary (100:1, 150:1, 298:1…) — higher ratio = slower but stronger.
