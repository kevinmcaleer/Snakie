# buckets: method call on an object, named pin, trailing comment
from machine import Pin
import time

led = Pin(25, Pin.OUT)

while True:
    led.on()
    time.sleep(0.5)  # half a second
    led.off()
    time.sleep(0.5)
