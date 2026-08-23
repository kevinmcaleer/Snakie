"""The same odometry, decoded by two PIO state machines.

This is the answer the hint recommends, so it must never be hinted at itself.
The counts arrive through the FIFO; nothing in Python reads either channel pin.
"""
import rp2
from machine import Pin

TICKS_PER_METRE = 1180


@rp2.asm_pio(in_shiftdir=rp2.PIO.SHIFT_LEFT, autopush=False)
def quadrature():
    wrap_target()
    mov(osr, isr)
    in_(pins, 2)
    mov(x, isr)
    jmp(x_not_y, "moved")
    jmp("wrap")
    label("moved")
    mov(y, x)
    push(noblock)
    label("wrap")
    wrap()


left = rp2.StateMachine(0, quadrature, freq=125_000, in_base=Pin(2))
right = rp2.StateMachine(1, quadrature, freq=125_000, in_base=Pin(4))
left.active(1)
right.active(1)


def metres_travelled():
    return (left.get() + right.get()) / (2 * TICKS_PER_METRE)


print("travelled", metres_travelled(), "m")
