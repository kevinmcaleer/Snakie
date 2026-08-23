"""The same rover log, written so every list has a ceiling.

`samples` is trimmed with a slice assignment, `recent` pops its oldest entry
once it is over the window, and `pending` is cleared after each flush to flash.
None of them can run the board out of RAM, so none of them should be flagged.
"""
import time
from machine import ADC, Pin

battery = ADC(29)
led = Pin(25, Pin.OUT)

WINDOW = 64
samples = []
recent = []
pending = []


def flush(rows):
    with open("log.csv", "a") as handle:
        for row in rows:
            handle.write("{},{}\n".format(row[0], row[1]))


while True:
    reading = battery.read_u16()
    samples.append(reading)
    samples[:] = samples[-WINDOW:]
    recent.append(reading)
    if len(recent) > WINDOW:
        recent.pop(0)
    pending.append((time.ticks_ms(), reading))
    if len(pending) >= 16:
        flush(pending)
        pending.clear()
    led.toggle()
    time.sleep_ms(100)
