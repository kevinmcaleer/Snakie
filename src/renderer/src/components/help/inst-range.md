A radar/gauge for an ultrasonic or ToF distance sensor.

## What it shows
Auto-picks a mode from the readings: a **GAUGE** with a needle plus distance-over-time history for a fixed sensor, or a **polar RADAR** sweep with fading trails when readings carry a bearing angle. Configure max range, mm/cm units, and a proximity **ALERT** threshold; out-of-range reads show `NO ECHO`.

## How to use it
Wire an HC-SR04 (TRIG out, ECHO in) and set both in the panel — it live-retargets the board with `SNKCMD range pins`. Your program prints `SNK DIST` via `inst.distance(mm)`. Start the control service so the pin selectors work.

## Snippet
```python
import instruments as inst

inst.start(range_trig=3, range_echo=2)
while True:
    mm = inst.ranger.read()
    if mm: inst.distance(mm)
    inst.control.poll()
```
