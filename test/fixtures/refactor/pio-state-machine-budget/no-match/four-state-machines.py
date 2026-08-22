"""The same rover after the servos were folded into one shared program.

Four state machines: lights, two wheels and one servo bank. Comfortably inside
the RP2040's eight, so the warning has nothing to say.
"""
import rp2
from machine import Pin


@rp2.asm_pio(sideset_init=rp2.PIO.OUT_LOW, out_shiftdir=rp2.PIO.SHIFT_LEFT, autopull=True)
def ws2812():
    wrap_target()
    out(x, 1).side(0)
    jmp(not_x, "zero").side(1)
    jmp("done").side(1)
    label("zero")
    nop().side(0)
    label("done")
    wrap()


@rp2.asm_pio(in_shiftdir=rp2.PIO.SHIFT_LEFT)
def quadrature():
    wrap_target()
    in_(pins, 2)
    push(noblock)
    wrap()


@rp2.asm_pio(out_init=(rp2.PIO.OUT_LOW,) * 4)
def servo_bank():
    wrap_target()
    pull(block)
    out(pins, 4)
    wrap()


lights = rp2.StateMachine(0, ws2812, freq=8_000_000, sideset_base=Pin(16))
left_wheel = rp2.StateMachine(1, quadrature, freq=125_000, in_base=Pin(2))
right_wheel = rp2.StateMachine(2, quadrature, freq=125_000, in_base=Pin(4))
arm = rp2.StateMachine(3, servo_bank, freq=1_000_000, out_base=Pin(18))

for sm in (lights, left_wheel, right_wheel, arm):
    sm.active(1)
