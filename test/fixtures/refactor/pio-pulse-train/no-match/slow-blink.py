import time
from machine import Pin

led = Pin("LED", Pin.OUT)


def blink():
    while True:
        led.on()
        time.sleep_ms(500)
        led.off()
        time.sleep_ms(500)
