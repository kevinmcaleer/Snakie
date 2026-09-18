# buckets: method call on an object, attribute read in an expression, if
from machine import Pin
import time

button = Pin(14, Pin.IN, Pin.PULL_UP)
led = Pin(15, Pin.OUT)

while True:
    if button.value() == 0:
        led.on()
    else:
        led.off()
    time.sleep(0.05)
