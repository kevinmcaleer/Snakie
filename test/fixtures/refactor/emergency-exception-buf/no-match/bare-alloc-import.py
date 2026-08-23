"""The same reservation, imported by name rather than through the module.

`alloc_emergency_exception_buf(100)` on its own is the identical call, so the
rule must recognise it and stay quiet.
"""
from micropython import alloc_emergency_exception_buf
from machine import Pin, Timer

alloc_emergency_exception_buf(100)

hall = Pin(22, Pin.IN)
revolutions = 0


def on_magnet(pin):
    global revolutions
    revolutions += 1


hall.irq(trigger=Pin.IRQ_FALLING, handler=on_magnet)

readout = Timer(-1)
readout.init(period=1000, mode=Timer.PERIODIC, callback=lambda t: print(revolutions))
