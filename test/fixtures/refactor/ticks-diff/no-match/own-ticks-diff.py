# This file already means something of its own by the name `ticks_diff`, so the
# rewrite would call the wrong function. It declines rather than guess.
from time import ticks_ms

WRAP = 1 << 30


def ticks_diff(new, old, wrap=WRAP):
    """A hand-rolled wrap-safe difference from before the port had one."""
    delta = (new - old) % wrap
    return delta - wrap if delta > wrap // 2 else delta


def watchdog(last_fed, limit_ms):
    return ticks_ms() - last_fed > limit_ms
