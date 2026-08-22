"""A short program carrying a lot of labels.

Thirty instructions and fourteen assembler directives — `label()`, `wrap()` and
`wrap_target()` mark positions rather than occupying slots, so counting them
would put this at forty-four and condemn a program that fits.
"""
import rp2
from machine import Pin


@rp2.asm_pio(set_init=rp2.PIO.OUT_LOW, in_shiftdir=rp2.PIO.SHIFT_LEFT)
def button_matrix():
    """Scan a four-by-three keypad, one column per labelled block."""
    wrap_target()
    label("col0")
    set(pins, 0b001)
    in_(pins, 4)
    label("col0_done")
    push(noblock)
    label("col1")
    set(pins, 0b010)
    in_(pins, 4)
    label("col1_done")
    push(noblock)
    label("col2")
    set(pins, 0b100)
    in_(pins, 4)
    label("col2_done")
    push(noblock)
    label("settle")
    set(x, 20)
    label("settle_loop")
    jmp(x_dec, "settle_loop")
    label("debounce")
    set(y, 20)
    label("debounce_loop")
    nop()[15]
    jmp(y_dec, "debounce_loop")
    label("report")
    mov(isr, null)
    in_(x, 8)
    push(noblock)
    label("idle")
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    nop()[31]
    wrap()


keypad = rp2.StateMachine(0, button_matrix, freq=100_000, set_base=Pin(9), in_base=Pin(12))
keypad.active(1)
print(keypad.get())
