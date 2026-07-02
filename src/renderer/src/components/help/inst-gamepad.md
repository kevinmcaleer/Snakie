Teleop — drive a connected robot **live** from a physical gamepad (browser Gamepad API) or the on-screen virtual stick + sliders.

## What it does
Each frame it reads the pad, shapes it through per-output **mappings** (deadzone / scale / trim / invert), and — while driving — streams `{name: value}` axes + pressed buttons at ~25 Hz via `sendControl('teleop', …)`. Safety: **HOLD TO DRIVE** (deadman) only streams while held; **E-STOP** latches every output to zero. Preview works with no robot attached.

## How to use it
Open **edit mapping** to name outputs and bind them to gamepad axes/buttons. On the board, read the stream each loop:

```python
import instruments as inst, time

inst.start()
while True:
    inst.control.poll()
    ax = inst.control.axes("teleop")   # {"drive":.5,"turn":-.2}
    fire = inst.control.pressed("teleop", 0)
    time.sleep(0.02)
```
