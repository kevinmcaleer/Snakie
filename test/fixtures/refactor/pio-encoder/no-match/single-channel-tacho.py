"""A one-channel tachometer on the rover's fan.

One pin, one counter, one interrupt. There is no second channel to combine, so
there is no direction to decode and nothing quadrature-shaped to point at.
"""
import time
from machine import Pin

tacho = Pin(8, Pin.IN, Pin.PULL_UP)
pulses = 0


def on_pulse(pin):
    global pulses
    if tacho.value() == 0:
        pulses += 1


tacho.irq(trigger=Pin.IRQ_FALLING, handler=on_pulse)


def rpm(window_ms=1000):
    global pulses
    pulses = 0
    time.sleep_ms(window_ms)
    return pulses * 60_000 // window_ms


print("fan rpm", rpm())
