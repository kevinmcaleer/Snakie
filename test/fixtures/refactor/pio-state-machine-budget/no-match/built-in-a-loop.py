"""Eight identical blinkers, built by one comprehension.

The file contains a single `StateMachine(...)` construction — the count is of
constructions written down, not of state machines the loop happens to create at
run time, so there is nothing here the rule can honestly claim.
"""
import rp2
from machine import Pin


@rp2.asm_pio(set_init=rp2.PIO.OUT_LOW)
def blink():
    wrap_target()
    set(pins, 1)[31]
    set(pins, 0)[31]
    wrap()


blinkers = [
    rp2.StateMachine(i, blink, freq=2_000, set_base=Pin(i)) for i in range(8)
]

for sm in blinkers:
    sm.active(1)
