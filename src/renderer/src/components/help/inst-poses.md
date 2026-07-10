A live **test bench** for your robot's servos — press a saved **pose** to glide every bound servo into place, or drag a **per-servo slider** to nudge one by hand. It works with or without a board.

## What it does
It reads your project's `robot.yml` — the **servo ↔ joint map** and your **saved poses** — and drives both the **on-screen 3-D model** (instantly, no program required) and the **real hardware**. A pose button (or a slider) moves the model live *and* writes one `SNKCMD servos "<pin>:<deg> …"` line via `sendControl('servos', …)` — the multi-servo payload the on-device `servos_command` receiver understands — so a running program follows too. Pose presses **ease** smoothly from the current position to the target.

## How to use it
1. In the **Board View**, wire a servo's signal to a GPIO; in the **Robot View**, bind that servo to a joint (and calibrate its range). The servo then appears here with a slider.
2. Save some **poses** in the Robot View — each becomes a quick-press button here.
3. Run a program that services the control channel, then test live:

```python
import instruments as inst, time

inst.start()               # opens the control channel
while True:
    inst.control.poll()    # slider / pose → servos.command(pin:deg …)
    time.sleep(0.02)
```

- Sliders send whole servo degrees (0–180); pose buttons apply each binding's calibration.
- Nothing bound yet? The panel tells you where to bind a servo.
