"""Pico rover data logger — three lists, one of which never stops growing.

`samples` gains a tuple on every pass of the main loop and nothing in the file
ever takes one back out, so the hint fires on it. `recent` is capped by hand and
`sweep` is filled by a bounded `for`, so both are left alone.

The rule offers no rewrite — a ring buffer or a file stream is a design
decision — so this file is its own `after.py`.
"""
import time
from machine import ADC, Pin

battery = ADC(29)
line = ADC(26)
led = Pin(25, Pin.OUT)

samples = []
recent = []
sweep = []

for angle in range(0, 181, 10):
    sweep.append(angle)


def trim(buffer, keep):
    while len(buffer) > keep:
        buffer.pop(0)


while True:
    reading = battery.read_u16()
    samples.append((time.ticks_ms(), reading))
    recent.append(reading)
    if len(recent) > 32:
        recent.pop(0)
    led.toggle()
    time.sleep_ms(200)
