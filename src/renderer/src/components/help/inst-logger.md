# Data Logger

A vintage **dot-matrix printer** that writes your robot's measurements onto
tractor-feed paper. Every numeric reading your program streams — meter volts,
plotted values, distances, temperature, IMU angles — is captured with a
timestamp, drawn as a strip-chart and "printed" as value rows. **Tear the page
off** to save the whole session as a CSV you can open in a spreadsheet.

It works fully offline against the **Simulated device**, so you can log data
with no hardware at all.

## Recording

1. Open the Data Logger from the instrument dock.
2. Press **● REC**. The red lamp blinks while it captures.
3. Stream some telemetry from your program (see below), or run a sketch that
   already does.
4. Press **❚❚ PAUSE** to stop; **● REC** again to resume onto the same page.
5. Press **✂ TEAR OFF** to download the session as `snakie-log-….csv` and start
   a fresh sheet.

## Streaming values to log

Anything you send through the `instruments` helper is captured:

```python
import instruments as inst
import time

while True:
    inst.plot(temp=read_temp(), light=read_light())  # named series
    inst.update()
    time.sleep(1)
```

Meter, distance, IMU and environment readings are logged too:

```python
inst.meter(adc=sensor.read_u16() * 3.3 / 65535)   # one column "meter:adc"
inst.env(t, p, h)                                   # temp / pressure / humidity
```

## The CSV

The tear-off is a **wide** CSV — a `time_s` column plus one column per series —
so it drops straight into Excel, Google Sheets or Python/pandas for a chart or a
lab write-up:

```
time_s,plot:temp,plot:light
0.000,21.4,880
1.001,21.6,875
2.003,21.9,860
```

## Tips

- Each distinct series (channel/label) becomes its own trace and its own CSV
  column, so log several sensors at once.
- Recording keeps going while the instrument is docked or popped out — pop it
  out to watch a long run in its own window.
