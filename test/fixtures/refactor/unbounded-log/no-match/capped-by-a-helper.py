"""Both lists have a ceiling — it is just enforced one call away.

`trim()` pops the oldest rows and `flush()` empties what it has written, which is
how a cap is usually spelled once it has outgrown a two-line `if`. From inside
the loop neither is distinguishable from a call that only reads, so a rule that
cannot see through a call must not claim nothing ever shortens these lists.
"""
import time
from machine import ADC

battery = ADC(29)
samples = []
pending = []


def trim(rows, keep):
    while len(rows) > keep:
        rows.pop(0)


def flush(rows):
    with open("log.csv", "a") as handle:
        for row in rows:
            handle.write("{}\n".format(row))
    del rows[:]


while True:
    reading = battery.read_u16()
    samples.append(reading)
    trim(samples, 64)
    pending.append(reading)
    flush(pending)
    time.sleep_ms(100)
