# buckets: tuple assign, subscript read, method call on an object, augmented assign
from machine import Pin
import time

SEQUENCE = [
    (1, 0, 0, 0),
    (0, 1, 0, 0),
    (0, 0, 1, 0),
    (0, 0, 0, 1),
]

coils = [Pin(2, Pin.OUT), Pin(3, Pin.OUT), Pin(4, Pin.OUT), Pin(5, Pin.OUT)]

step = 0
for _ in range(512):
    pattern = SEQUENCE[step % len(SEQUENCE)]
    for index in range(4):
        coils[index].value(pattern[index])
    step += 1
    time.sleep_ms(2)
