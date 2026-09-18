# buckets: method call on an object, attribute read in an expression, trailing comment
from machine import Pin
import time

button = Pin(14, Pin.IN, Pin.PULL_UP)

last = button.value()
changed_at = time.ticks_ms()
DEBOUNCE = 30  # milliseconds

while True:
    now = button.value()
    if now != last:
        changed_at = time.ticks_ms()
        last = now
    if time.ticks_diff(time.ticks_ms(), changed_at) > DEBOUNCE:
        if now == 0:
            print("pressed")
    time.sleep_ms(5)
