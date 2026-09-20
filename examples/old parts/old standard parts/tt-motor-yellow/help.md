# TT Motor (Yellow)

The **yellow-gearbox "TT" motor** — the brushed DC gear motor that ships with
almost every cheap acrylic/plastic 2WD or 4WD robot car chassis. Plastic
gearbox, a pair of M3 mounting holes either side, a 5 mm D-shaft, and two
wire leads.

## Wiring

| Pin | Connect to |
|-----|------------|
| VCC | motor driver **output** (e.g. L298N / TB6612 / DRV8833 OUT1) |
| GND | motor driver **output** (e.g. OUT2) |

⚠️ **Never wire a motor straight to a GPIO pin.** A GPIO supplies a few
milliamps; a TT motor can pull over an amp when stalled. Drive it through an
H-bridge (L298N, TB6612FNG, DRV8833…) powered from its own **3–6 V** supply
(4×AA is the classic choice), with GND shared with the microcontroller.

⚠️ The two leads aren't really "+" and "−" — swapping them just reverses the
spin direction. That's exactly how the H-bridge reverses it too, so don't
worry about getting the wire colours "right".

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

- Sold in a few gear ratios (48:1, 120:1, 298:1…) — lower ratio = faster but
  weaker, higher ratio = slower but stronger. Most "200 RPM @ 6 V" chassis
  kits use the 48:1 version.
- A pair of these driven differentially (one per side) is the standard 2WD
  robot car drivetrain — steer by running the two sides at different speeds.
- Below ~30 % duty the gearbox may stall — start higher, then ease down.
- The plastic gearbox tolerates light side-load from the wheel, but avoid
  bolting it down warped — it binds the gears and spikes the stall current.
- Solder a small **ceramic capacitor** across the two leads to tame
  electrical noise if your board resets when the motor kicks in.
