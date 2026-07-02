A strip-chart recorder that graphs numeric serial output over time.

## What it shows
A scrolling, auto-scaling line chart on a blue-phosphor screen, with a per-series legend and a `<N> samples · <Hz>` readout. Reads the same serial stream as the terminal (non-disruptively); the metal **CLEAR** key resets the buffer.

## How to use it
Just `print()` numbers — single values, comma/space/tab rows, or `label:value` pairs all work. For clean named series use `inst.plot()`, which emits a `SNK PLOT` row (only `PLOT` lines are graphed; SCOPE/METER are ignored). Series cap at 16, window at 200 samples.

## Snippet
```python
import instruments as inst

while True:
    inst.plot(temp=21.4, light=80)
    # or plain: print(temp, light)
```
