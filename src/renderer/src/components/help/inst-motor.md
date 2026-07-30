The **write** panel for a two-channel DC motor driver — signed power bars for A and B, a linked **Throttle** with **Trim**, and **STOP** / **BRAKE** / **STANDBY**.

## What it does
Moving a slider writes `SNKCMD motor <payload>` via `sendControl('motor', …)`: `run <a> <b>` for both channels, `a <power>` / `b <power>` for one. The buttons write `stop` (coast), `brake` (windings shorted) and `standby 0|1`. Powers are **signed and normalised**, `-1.0`…`1.0` — the same unit `teleop.arcade_mix` emits, so the panel doesn't care whether a TB6612 or a bare PWM bridge is on the other end.

The bars show what the board **applied**, from its `SNK MOTOR <a> <b>` report, falling back to the commanded value. That difference matters: a driver left in standby accepts every command and turns nothing.

## How to use it
Install the `tb6612` module, then run a program that services the control channel:

```python
import instruments as inst, time
from machine import I2C, Pin
from tb6612 import GroveMotorDriver

inst.motor.driver = GroveMotorDriver(I2C(1, sda=Pin(6), scl=Pin(7)))
inst.motor.standby(False)      # nothing turns until standby is released
while True:
    inst.control.poll()        # sliders → motor.drive(a, b)
    time.sleep(0.02)
```

## Calibrating with it
This panel exists for the two measurements that are miserable to get by editing numbers and re-running:

- **Deadband** — un-link the channels and nudge one up until the wheel *actually* starts turning. Below that, PWM is just heat.
- **Trim** — link the channels, drive both from one slider, and adjust **Trim** until the robot tracks straight. Positive favours A, negative favours B. Trim reduces the *other* side rather than boosting past the commanded power, so it still works at full throttle where there is no headroom to boost into.

Write the two numbers you land on into your robot code.

## Safety
**STANDBY** disables the driver's outputs entirely and is the state to leave a rover in. **BRAKE** stops hard; **STOP** lets it coast.
