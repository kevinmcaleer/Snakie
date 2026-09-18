# buckets: .append(), method call on an object, tuple assign, for/in
from machine import Pin, PWM
import time

buzzer = PWM(Pin(16))

NOTES = {"C": 262, "D": 294, "E": 330, "F": 349, "G": 392}

tune = []
for name in "EDCDEEE":
    tune.append((name, 200))

for name, length in tune:
    buzzer.freq(NOTES[name])
    buzzer.duty_u16(2000)
    time.sleep_ms(length)
    buzzer.duty_u16(0)
    time.sleep_ms(50)
