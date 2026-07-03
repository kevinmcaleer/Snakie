Control flow — deciding and repeating. MicroPython uses standard Python syntax:
indentation (4 spaces) marks the block.

## if / elif / else

```python
temp = 21.5
if temp > 30:
    print("hot")
elif temp > 15:
    print("comfortable")
else:
    print("cold")
```

Conditions combine with `and`, `or`, `not`; membership tests use `in`;
identity uses `is` (mostly for `None`: `if reading is None:`).

## while — repeat until told to stop

```python
from machine import Pin
import time

led = Pin("LED", Pin.OUT)
while True:          # the classic firmware main loop
    led.toggle()
    time.sleep(0.5)
```

## for — repeat over a sequence

```python
for n in range(5):        # 0, 1, 2, 3, 4
    print(n)

for name in ["red", "green", "blue"]:
    print(name)
```

## break · continue · pass

```python
while True:
    if button.value() == 0:
        break        # leave the loop entirely
    if sensor_busy():
        continue     # skip to the next iteration
    read_sensor()

def todo():
    pass             # a do-nothing placeholder body
```

## Tips

- A bare `while True:` with a small `time.sleep()` is the normal shape of a
  MicroPython program — see the Timing article for non-blocking loops.
- Truthiness: `0`, `""`, `[]`, `{}` and `None` all read as `False`.
