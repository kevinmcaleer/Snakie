"""Wait for the rover's start button, then debounce the release.

Two `while` loops spinning on a pin — but they sleep between looks and no clock
is read either side, so nothing here is measuring a pulse.
"""
import time
from machine import Pin

start_button = Pin(12, Pin.IN, Pin.PULL_UP)
ready_led = Pin(25, Pin.OUT)


def wait_for_press():
    ready_led.on()
    while start_button.value() == 1:
        time.sleep_ms(5)
    while start_button.value() == 0:
        time.sleep_ms(5)
    ready_led.off()


wait_for_press()
print("go")
