Write MicroPython in the editor and run it straight on the board.

## Open or create a file

- Open a `.py` from the file tree on the left, **or**
- Hit <kbd>+</kbd> on the tab strip for a fresh buffer.

```python
from machine import Pin
from time import sleep

led = Pin("LED", Pin.OUT)
while True:
    led.toggle()
    sleep(0.5)
```

## Run & stop

- **Run** executes the current file on the device; output appears in the terminal below.
- **Stop** interrupts it (same as <kbd>Ctrl</kbd>+<kbd>C</kbd>) — handy for a `while True:` loop.

## Save & upload

**Save & upload** copies the file onto the board so it sticks around. Name it `main.py` to run automatically every time the board boots.
