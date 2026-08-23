from machine import Pin

led = Pin(5, Pin.OUT)


def flash(pattern):
    for i in range(8):
        led.value((pattern >> i) & 1)
