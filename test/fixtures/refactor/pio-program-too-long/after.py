"""Half-step sequencer for the rover's 28BYJ-48 lead-screw stepper.

Both directions are written out longhand, one instruction per phase, which puts
the program well past the 32 slots a PIO block has. The rule counts it and says
so; folding the phase table into the FIFO is the author's job, so this file is
its own `after.py`.
"""
import rp2
from machine import Pin

COIL_BASE = 6
STEPS_PER_TURN = 4096


@rp2.asm_pio(set_init=(rp2.PIO.OUT_LOW,) * 4, out_shiftdir=rp2.PIO.SHIFT_RIGHT)
def half_step():
    """Eight-phase half-step sequence, forwards and backwards."""
    wrap_target()
    pull(block)
    mov(x, osr)
    pull(block)
    mov(y, osr)
    jmp(not_y, "forward")
    jmp("reverse")

    label("forward")
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
    jmp(x_dec, "forward")
    jmp("done")

    label("reverse")
    set(pins, 0b1001)
    nop()[31]
    set(pins, 0b1000)
    nop()[31]
    set(pins, 0b1100)
    nop()[31]
    set(pins, 0b0100)
    nop()[31]
    set(pins, 0b0110)
    nop()[31]
    set(pins, 0b0010)
    nop()[31]
    set(pins, 0b0011)
    nop()[31]
    set(pins, 0b0001)
    nop()[31]
    jmp(x_dec, "reverse")

    label("done")
    set(pins, 0b0000)
    irq(rel(0))
    wrap()


lead_screw = rp2.StateMachine(0, half_step, freq=20_000, set_base=Pin(COIL_BASE))
lead_screw.active(1)


def turn(revolutions, forward=True):
    lead_screw.put(int(revolutions * STEPS_PER_TURN))
    lead_screw.put(0 if forward else 1)


turn(0.25)
