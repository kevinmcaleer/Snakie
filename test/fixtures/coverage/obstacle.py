# buckets: named pin, method call on an object, early return, trailing comment
from machine import Pin, time_pulse_us
import time

trigger = Pin(3, Pin.OUT)
echo = Pin(2, Pin.IN)


def distance():
    trigger.low()
    time.sleep_us(2)
    trigger.high()
    time.sleep_us(10)
    trigger.low()
    width = time_pulse_us(echo, 1, 30000)
    if width < 0:
        return None
    return width * 0.0343 / 2  # centimetres


while True:
    cm = distance()
    if cm is None:
        print("no echo")
    else:
        print(cm)
    time.sleep(0.2)
