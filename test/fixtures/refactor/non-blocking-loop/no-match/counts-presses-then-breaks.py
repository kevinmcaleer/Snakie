"""Count button presses until ten, then move on.

The `break` and the `continue` both leave the body, and the body is exactly what
would move inside a new `if`. A `continue` that used to jump past the sleep
would jump past nothing, so the rule declines rather than change what the loop
does.
"""
import time
from machine import Pin

button = Pin(14, Pin.IN, Pin.PULL_UP)
led = Pin(25, Pin.OUT)
presses = 0

while True:
    led.toggle()
    if button.value() == 1:
        continue
    presses = presses + 1
    if presses >= 10:
        break
    time.sleep(0.05)

print("done", presses)
