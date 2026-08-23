"""The same HC-SR04, with the echo pulse counted by a PIO state machine.

This is the answer the hint recommends, so it must never be hinted at itself:
the count arrives through the FIFO and nothing in Python waits on the echo pin.
"""
import rp2
import time
from machine import Pin

US_PER_CM = 58.0

trigger = Pin(14, Pin.OUT, value=0)


@rp2.asm_pio(set_init=rp2.PIO.OUT_LOW, in_shiftdir=rp2.PIO.SHIFT_LEFT)
def echo_timer():
    wrap_target()
    set(x, 0)
    wait(0, pin, 0)
    wait(1, pin, 0)
    label("counting")
    jmp(pin, "still_high")
    jmp("done")
    label("still_high")
    jmp(x_dec, "counting")
    label("done")
    mov(isr, x)
    push(block)
    wrap()


ranger = rp2.StateMachine(0, echo_timer, freq=1_000_000, in_base=Pin(15), jmp_pin=Pin(15))
ranger.active(1)


def ping():
    trigger.value(1)
    time.sleep_us(10)
    trigger.value(0)
    return (0xFFFFFFFF - ranger.get()) / US_PER_CM


print(ping())
