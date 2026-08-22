"""A 32-instruction PIO program: exactly full, and perfectly legal.

One direction of the same half-step sequence, plus a settling ramp. It uses
every slot in the block and not one more, so the rule must stay quiet — an
off-by-one here would call working code broken.
"""
import rp2
from machine import Pin


@rp2.asm_pio(set_init=(rp2.PIO.OUT_LOW,) * 4)
def half_step_forward():
    """32 instructions exactly."""
    wrap_target()
    pull(block)
    mov(x, osr)
    label("phase")
    set(pins, 0b0001)
    nop()[31]
    set(pins, 0b0011)
    nop()[31]
    set(pins, 0b0010)
    nop()[31]
    set(pins, 0b0110)
    nop()[31]
    set(pins, 0b0100)
    nop()[31]
    set(pins, 0b1100)
    nop()[31]
    set(pins, 0b1000)
    nop()[31]
    set(pins, 0b1001)
    nop()[31]
    jmp(x_dec, "phase")
    set(pins, 0b0000)
    set(y, 8)
    label("settle")
    nop()[31]
    nop()[31]
    jmp(y_dec, "settle")
    irq(rel(0))
    nop()
    nop()
    nop()
    wrap()


lead_screw = rp2.StateMachine(0, half_step_forward, freq=20_000, set_base=Pin(6))
lead_screw.active(1)
lead_screw.put(512)
