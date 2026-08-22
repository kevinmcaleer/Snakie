"""Telemetry logger that really does fill the heap on every pass.

Each pass builds a dict, formats it into an f-string and appends the result to a
list. The collect in there is holding a fragmenting heap together, and whoever
wrote it knows more about this loop than we do.
"""

import gc
import time


def log_run(sensors, passes):
    rows = []
    for _ in range(passes):
        sample = {"t": time.ticks_ms(), "v": sensors.read()}
        rows.append(f"{sample['t']},{sample['v']}")
        gc.collect()
        time.sleep_ms(10)
    return rows


def batch(sensors, passes):
    out = []
    n = 0
    while n < passes:
        out.append([sensors.read(), sensors.read()])
        gc.collect()
        n += 1
    return out
