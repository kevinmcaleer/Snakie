"""A 32-instruction PIO program: exactly full, and perfectly legal.

One direction of the same half-step sequence, plus a settle and a cool-down. It
uses every slot in the block and not one more, so the rule must stay quiet — an
off-by-one here would call working code broken.
"""
import rp2
from machine import Pin


@rp2.asm_pio(set_init=(rp2.PIO.OUT_LOW,) * 4, in_shiftdir=rp2.PIO.SHIFT_LEFT)
def half_step_forward():
    """Exactly 32 instructions; `label`, `wrap` and `wrap_target` are free."""
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
    mov(isr, x)
    push(noblock)
    set(y, 8)
    label("settle")
    nop()[31]
    nop()[31]
    jmp(y_dec, "settle")
    irq(rel(0))
    set(y, 4)
    label("cool")
    nop()[31]
    jmp(y_dec, "cool")
    mov(isr, null)
    push(noblock)
    wrap()


lead_screw = rp2.StateMachine(0, half_step_forward, freq=20_000, set_base=Pin(6))
lead_screw.active(1)
lead_screw.put(512)
