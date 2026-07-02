# SG90 Micro Servo

A 9 g hobby servo with ~180° of travel, controlled by a 50 Hz PWM signal. Cheap,
light, and everywhere — pan/tilt rigs, robot arms, grippers, RC.

## Wiring

| Wire | Signal | Connect to |
|------|--------|-----------|
| **Orange** | Signal (PWM) | any GPIO |
| **Red** | VCC (+5 V) | a **5 V** supply (4.8–6 V) |
| **Brown** | GND | board GND (**shared** with your supply) |

⚠️ Don't power a servo from the Pico's **3V3** pin — it browns out under load.
Use the **VBUS/5 V** pin or a separate 5 V supply, and tie the grounds together.

## Quick start

```python
from servo import Servo

s = Servo(16)      # signal on GP16
s.angle(90)        # centre
s.angle(0)         # one end
s.angle(180)       # the other end
```

## How it works — the PWM signal

The servo reads a **50 Hz** signal (a 20 ms frame). The **pulse width** sets the
angle:

- **1.0 ms → 0°**, **1.5 ms → 90°**, **2.0 ms → 180°**
- Many SG90s accept a wider **0.5–2.5 ms** for a fuller sweep.

In the **Servo instrument** you can drag the dial, sweep between limits, and set
the min/max — it sends the angle to the board live.

## API cheatsheet

```text
Servo(pin, freq=50, min_us=500, max_us=2500, min_angle=0, max_angle=180)
angle(deg)      set (or, with no arg, read) the angle
min() / max()   go to the angle limits
write_us(us)    drive a raw pulse width
sweep(a, b)     blocking end-to-end sweep
ease(target, ms, easing="in_out")   smooth glide (linear/in/out/in_out)
detach()        release (stop holding torque)
```

## Specs

- Torque ≈ 1.8 kg·cm @ 4.8 V · speed ≈ 0.1 s/60° · rotation ≈ 180°
- Body ≈ 22.8 × 12.2 × 22.7 mm · weight ≈ 9 g

## Troubleshooting

- **Jitter / twitching** → shared GND + a dedicated 5 V supply (not 3V3).
- **Buzzing at rest** → `detach()` once it reaches the end stop.
- **Limited range** → widen `min_us` / `max_us` in the `Servo(...)` constructor.
