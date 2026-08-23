"""A `collect()` that has nothing to do with the garbage collector.

The bin-picking arm collects a part on every pass, and the sample store has a
`collect` method of its own. Neither is `gc.collect()`, and without an import
saying so there is no reason to think it is.
"""

import time


class SampleStore:
    def __init__(self):
        self.count = 0

    def collect(self):
        self.count += 1


store = SampleStore()


def pick(arm, parts):
    for _ in range(parts):
        arm.reach()
        arm.collect()
        time.sleep_ms(50)


def tally(passes):
    n = 0
    while n < passes:
        store.collect()
        time.sleep_ms(5)
        n += 1
    return store.count
