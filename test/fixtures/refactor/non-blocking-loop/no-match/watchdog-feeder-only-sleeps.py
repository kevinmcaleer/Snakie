"""A watchdog feeder that does one thing and then waits.

Only one statement runs before the sleep, so there is nothing for a tick check
to interleave with. Converting this would swap a parked CPU for one spinning
flat out — the busy-wait rule 84 warns about — for no gain at all.
"""
import time
from machine import WDT

wdt = WDT(timeout=8000)

while True:
    wdt.feed()
    time.sleep(2)
