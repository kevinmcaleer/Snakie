Instruments are live gauges — scope, meter, plotter, IMU, range, and more — fed by your program.

## The instrument dock

Instruments live in the **dock** on the right. Use **+ Add instrument** to pick one, and each has **Show/Hide** toggles. On a window, use **Dock to side** / **Float as overlay** to pop it out over the app, and **Close** to dismiss it.

## Feed them from code

Copy `instruments.py` onto the board, then have your loop **print** readings — Snakie parses the serial stream, so it never interrupts a running program.

```python
import time
import instruments as inst

inst.start(buzzer_pin=15)   # register receivers

while True:
    inst.control.poll()     # service IDE commands + heartbeat
    inst.scope(value, ch="ch1")
    inst.meter(1.65, ch="adc0")
    inst.plot(temp=21.4, light=80)
    time.sleep(0.05)
```

Open the matching instrument, run the program, and it updates live — no LIVE toggle needed.
