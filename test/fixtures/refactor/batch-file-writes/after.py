"""Datalogger for a Pico weather mast — one flash write per sample.

Each `write()` erases and rewrites a whole flash block, and the `flush()` makes
sure it happens every single time round. Buffering changes what survives a
power cut, so the rule explains and leaves the code alone: this file is its own
`after.py`.
"""
import time
from machine import ADC, Pin

wind = ADC(26)
rain = Pin(15, Pin.IN, Pin.PULL_UP)

log = open("wind.csv", "a")


def record(samples):
    for n in range(samples):
        log.write("%d,%d\n" % (time.ticks_ms(), wind.read_u16()))
        log.flush()
        time.sleep_ms(100)


def watch_rain():
    with open("rain.csv", "a") as journal:
        while True:
            if not rain.value():
                journal.write("%d\n" % time.ticks_ms())
            time.sleep_ms(20)


def write_header():
    # Once per run, before the loop starts — nothing to fix here.
    log.write("ms,wind_u16\n")
