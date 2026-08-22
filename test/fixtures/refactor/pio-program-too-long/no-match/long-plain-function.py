"""A long ordinary function that happens to live next to some PIO code.

Forty-odd statements, but no `@rp2.asm_pio` decorator — this is Python, it runs
from RAM, and the 32-instruction limit has nothing to do with it.
"""
import rp2
from machine import Pin

LEDS = [Pin(n, Pin.OUT) for n in range(2, 10)]


@rp2.asm_pio(set_init=rp2.PIO.OUT_LOW)
def blink():
    wrap_target()
    set(pins, 1)[31]
    set(pins, 0)[31]
    wrap()


def startup_sequence():
    """Walk the bar up, down, and flash it — deliberately written out longhand."""
    LEDS[0].on()
    LEDS[1].on()
    LEDS[2].on()
    LEDS[3].on()
    LEDS[4].on()
    LEDS[5].on()
    LEDS[6].on()
    LEDS[7].on()
    LEDS[7].off()
    LEDS[6].off()
    LEDS[5].off()
    LEDS[4].off()
    LEDS[3].off()
    LEDS[2].off()
    LEDS[1].off()
    LEDS[0].off()
    LEDS[0].on()
    LEDS[2].on()
    LEDS[4].on()
    LEDS[6].on()
    LEDS[0].off()
    LEDS[2].off()
    LEDS[4].off()
    LEDS[6].off()
    LEDS[1].on()
    LEDS[3].on()
    LEDS[5].on()
    LEDS[7].on()
    LEDS[1].off()
    LEDS[3].off()
    LEDS[5].off()
    LEDS[7].off()
    LEDS[0].on()
    LEDS[7].on()
    LEDS[0].off()
    LEDS[7].off()
    LEDS[3].on()
    LEDS[4].on()
    LEDS[3].off()
    LEDS[4].off()
    print("ready")


status = rp2.StateMachine(0, blink, freq=2_000, set_base=Pin(25))
status.active(1)
startup_sequence()
