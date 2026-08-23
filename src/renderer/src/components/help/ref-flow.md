Control flow — deciding and repeating. This is standard Python, identical on
MicroPython and CircuitPython: indentation (4 spaces) marks the block.

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
import time

ticks = 0
while True:          # the classic firmware main loop
    ticks += 1
    print("tick", ticks)
    time.sleep(0.5)
```

`time.sleep()` takes **seconds** on both runtimes, so this loop is portable —
see the Pins page for your runtime to put an LED in it.

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
  microcontroller program — see the Timing article for non-blocking loops.
- Truthiness: `0`, `""`, `[]`, `{}` and `None` all read as `False`.
