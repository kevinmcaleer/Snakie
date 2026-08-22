"""A `nonlocal` in a nested scope writes the variable behind the block's back.

`edges` is bumped by the interrupt handler, not by anything the selection can
see. Passing it to a new function passes a *copy*, so `while edges < 3` would
read the same 0 for ever and the rover would hang — the worst kind of wrong,
because the code still looks right.
"""

import time


def wait_for_edges(pin):
    edges = 0

    def on_edge(_):
        nonlocal edges
        edges += 1

    pin.irq(handler=on_edge)
    while edges < 3:
        time.sleep_ms(10)
    return edges
