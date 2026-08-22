"""The light-bar again, this time clocked by a PIO state machine.

The other answer the hint recommends: the stock `asm_pio` WS2812 program. The
loop below only feeds the FIFO, so there is no pin write and no microsecond
sleep for the rule to find.
"""
import rp2
from machine import Pin

T1 = 2
T2 = 5
T3 = 3


@rp2.asm_pio(
    sideset_init=rp2.PIO.OUT_LOW,
    out_shiftdir=rp2.PIO.SHIFT_LEFT,
    autopull=True,
    pull_thresh=24
)
def ws2812():
    wrap_target()
    label("bitloop")
    out(x, 1).side(0)[T3 - 1]
    jmp(not_x, "do_zero").side(1)[T1 - 1]
    jmp("bitloop").side(1)[T2 - 1]
    label("do_zero")
    nop().side(0)[T2 - 1]
    wrap()


strip = rp2.StateMachine(0, ws2812, freq=8_000_000, sideset_base=Pin(16))
strip.active(1)


def show(bar):
    for colour in bar:
        strip.put(colour, 8)


show([0x002000, 0x203200, 0x200000, 0x200000])
