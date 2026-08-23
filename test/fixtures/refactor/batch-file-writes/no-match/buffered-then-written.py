"""The fixed logger: collect a block of samples, then write it in one call."""
import time
from machine import ADC

wind = ADC(26)
BLOCK = 200


def record(samples):
    log = open("wind.csv", "a")
    rows = []
    for n in range(samples):
        rows.append("%d,%d\n" % (time.ticks_ms(), wind.read_u16()))
        if len(rows) == BLOCK:
            log.write("".join(rows))
            rows = []
        time.sleep_ms(100)
    log.write("".join(rows))
    log.close()
