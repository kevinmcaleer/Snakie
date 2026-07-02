The **write** panel for a hobby servo (SG90 etc.) — a top-down dial you drag to set the angle, a **SWEEP** that ping-pongs the limits, and MIN/MAX/PIN fields.

## What it does
Dragging the arm (or the slider) writes `SNKCMD servo angle <deg>` via `sendControl('servo', …)`; the **PIN** field writes `pin <n>` (re-attach on GP*n* at 50 Hz) and **DETACH** writes `detach` to drop holding torque. A live `SNK PWM servo …` reading draws a faint MEASURED arm.

## How to use it
Attach a servo signal wire to a PWM GPIO, then run a program that services the control channel:

```python
import instruments as inst, time

inst.start(servo_pin=16)   # attach on GP16 @ 50 Hz
while True:
    inst.control.poll()    # dial → servo.angle(deg)
    time.sleep(0.02)
```

- MIN/MAX cap the travel; the readout shows ANGLE, PULSE (ms) and RANGE.
