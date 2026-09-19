# 2WD Robot Car Chassis

The clear-acrylic **"smart car" kit** that starts most first robots: a
laser-cut plate, two yellow **TT gear motors** on T-brackets, two Ø65 mm
wheels rising through notches in the plate, a **steel-ball caster** under the
nose and a **4×AA battery box** on top. Sold under dozens of names (DollaTek,
Emgreat, Elegoo, diymore, "2WD Smart Robot Car Chassis Kit" …) and all cut to
the same pattern. This part is the assembled kit, modelled in 3-D for the
Robot View, with the motors and the battery pack brought out as pins so it
wires like the real thing.

## What's in the box

| Item | Detail |
|---|---|
| Plate | 210 × 150 × 3 mm acrylic, two wheel notches, an M3 hole grid |
| Motors | 2 × TT gear motor, 1:48, 3–6 V, dual Ø5.4 mm D-shaft, ~29 g each |
| Wheels | 2 × Ø65 × 26 mm yellow hub with a rubber tyre, ~26 g each |
| Caster | Steel-ball "universal wheel", 18 × 25 × 20 mm, on two M3 × 30 mm brass standoffs |
| Encoders | 2 × 20-slot discs for the inner shafts (the optical sensor module is **not** included) |
| Power | 4×AA holder with a slide switch — ~6 V, ~2 A comfortably |
| Hardware | 4 × acrylic T-brackets, M3 screws and nuts |

Wheelbase (axle to caster) is 135 mm, track 120 mm, and the plate rides 50 mm
off the floor. Weight is about 250 g assembled; four alkaline AAs add ~90 g.
The exact hole pattern varies between batches — the model's grid is
representative, not gospel.

## Wiring

| Pin | Connect to |
|-----|------------|
| `ML+` / `ML-` | motor driver **output** A (e.g. MX1508 / DRV8833 OUT1, OUT2) |
| `MR+` / `MR-` | motor driver **output** B (OUT3, OUT4) |
| `V+` | motor driver **VIN / VM** (the pack's ~6 V) |
| `GND` | motor driver GND **and** the Pico's GND |

⚠️ **Never wire a motor straight to a GPIO pin.** A GPIO supplies a few
milliamps; a stalled TT motor wants close to an amp. Drive each motor through
an H-bridge channel powered from the battery pack, with the pack's GND shared
with the Pico. The `+`/`-` on the motor pins are only nominal — swapping a pair
just reverses that wheel, which is the easiest way to fix a motor that spins
the wrong way.

The 4×AA pack is fine for the motors. Running the Pico from it too means
feeding **6 V into VSYS** (the Pico regulates it down); do not put it on 3V3.

## Quick start

An MX1508 with its inputs on **GP2–GP5**: PWM one input of each channel for
speed, and swap which input gets the PWM to reverse.

```python
from machine import Pin, PWM
import time

left = (PWM(Pin(2), freq=1000), PWM(Pin(3), freq=1000))
right = (PWM(Pin(4), freq=1000), PWM(Pin(5), freq=1000))

def motor(pair, speed):            # -100 … +100 %
    duty = int(abs(speed) * 65535 / 100)
    pair[0].duty_u16(duty if speed > 0 else 0)
    pair[1].duty_u16(duty if speed < 0 else 0)

def drive(l, r):
    motor(left, l)
    motor(right, r)

drive(70, 70)      # forward
time.sleep(1.5)
drive(60, -60)     # spin on the spot
time.sleep(0.8)
drive(0, 0)        # stop
```

## Tips

- The wheels poke **up through the side notches** — that is by design, and it
  is why nothing tall goes at the outer rear corners of the plate.
- Two 1:48 motors never run at quite the same speed, so a car driven
  open-loop drifts. Trim one side's duty, or add the optical encoder modules
  the slotted discs are made for and count pulses.
- The T-brackets crack if the long screws are over-tightened; snug is enough.
  A dab of hot glue between the gearbox and the plate stops the motors
  walking.
- Fresh alkaline cells sag hard under a stall. If the Pico resets when the
  motors start, that is the pack, not your code — NiMH cells or a 2S LiPo
  behave much better.

## In the Robot View

The 3-D model is millimetres, +x forward, and sits with its wheels on z = 0,
so a placed chassis rests on the floor. Its three ground `contacts` are the
two tyres and the caster ball; the declared mass and centre of mass are for
the assembled kit without cells.
