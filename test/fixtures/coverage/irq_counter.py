# buckets: method call on an object, global, lambda-free callback, attribute read
from machine import Pin
import time

pulses = 0


def count(pin):
    global pulses
    pulses += 1


sensor = Pin(17, Pin.IN, Pin.PULL_UP)
sensor.irq(trigger=Pin.IRQ_FALLING, handler=count)

while True:
    print(pulses)
    pulses = 0
    time.sleep(1)
