# Yellow TT Motor

A **3–6 V brushed DC gear motor** in the classic yellow-plastic "TT" gearbox —
the motor bolted to the wheels on nearly every budget robot chassis kit.

## Wiring

| Pin | Connect to |
|-----|------------|
| VCC | motor driver **output** (e.g. MX1508 / DRV8833 OUT1) |
| GND | motor driver **output** (e.g. OUT2) |

⚠️ **Never wire a motor straight to a GPIO pin.** A GPIO supplies a few
milliamps; a motor wants hundreds. Drive it through an H-bridge (MX1508,
DRV8833, L298N…) powered from its own supply, with GND shared with the Pico.

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

- The plastic gearbox is bolted on with two screws through the mounting
  tabs either side — matching wheel hubs simply press onto the D-shaft.
- Gear ratios vary (48:1, 120:1, 298:1…) — higher ratio = slower but stronger.
- Two of these plus a caster make a simple two-wheel-drive chassis; drive
  each motor from its own H-bridge channel.

## 3-D model

The model shown in the Robot View is the **3777 TT Motor** from
[Adafruit_CAD_Parts](https://github.com/adafruit/Adafruit_CAD_Parts)
(MIT licence, © 2016 Adafruit Industries), 1:48 gearbox with the standard
double-sided 5.5 mm D-shaft. Dimensions are the real thing (≈ 22 × 37 × 70 mm
including the shafts and motor can), so it lines up with wheel hubs and
chassis mounts drawn to the same spec. STEP and Fusion 360 versions live in
the same repository if you want to edit it.
