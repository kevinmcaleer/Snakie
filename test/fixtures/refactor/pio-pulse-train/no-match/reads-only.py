import time
from machine import Pin

button = Pin(14, Pin.IN)


def poll():
    while True:
        if button.value():
            return True
        time.sleep_us(200)
