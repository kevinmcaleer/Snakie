"""Every peripheral on the rover, each one given its own PIO state machine.

Six state machines out of the RP2040's eight, and the servos alone account for
three of them. The rule counts them and names the board's real budget; folding
them together is a redesign, so this file is its own `after.py`.
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


@rp2.asm_pio(in_shiftdir=rp2.PIO.SHIFT_LEFT)
def quadrature():
    wrap_target()
    in_(pins, 2)
    mov(x, isr)
    jmp(x_not_y, "moved")
    jmp("wrap")
    label("moved")
    mov(y, x)
    push(noblock)
    label("wrap")
    wrap()


@rp2.asm_pio(set_init=rp2.PIO.OUT_LOW)
def servo_pulse():
    wrap_target()
    pull(noblock)
    mov(x, osr)
    set(pins, 1)
    label("high")
    jmp(x_dec, "high")
    set(pins, 0)
    wrap()


lights = rp2.StateMachine(0, ws2812, freq=8_000_000, sideset_base=Pin(16))
left_wheel = rp2.StateMachine(1, quadrature, freq=125_000, in_base=Pin(2))
right_wheel = rp2.StateMachine(2, quadrature, freq=125_000, in_base=Pin(4))
shoulder = rp2.StateMachine(3, servo_pulse, freq=1_000_000, set_base=Pin(18))
elbow = rp2.StateMachine(4, servo_pulse, freq=1_000_000, set_base=Pin(19))
gripper = rp2.StateMachine(5, servo_pulse, freq=1_000_000, set_base=Pin(20))

for sm in (lights, left_wheel, right_wheel, shoulder, elbow, gripper):
    sm.active(1)
