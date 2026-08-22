# Already uses the wrap-safe helper everywhere — nothing to offer here.
from time import ticks_ms, ticks_diff, sleep_ms
from machine import Pin

button = Pin(16, Pin.IN, Pin.PULL_UP)


def debounce(hold_ms):
    pressed_at = ticks_ms()
    while ticks_diff(ticks_ms(), pressed_at) < hold_ms:
        if button.value():
            return False
        sleep_ms(2)
    return True
