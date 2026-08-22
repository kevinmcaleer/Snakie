"""Interrupts with the buffer already reserved — nothing to add."""
import micropython
import time
from machine import Pin

micropython.alloc_emergency_exception_buf(100)

button = Pin(15, Pin.IN, Pin.PULL_UP)
presses = 0


def on_press(pin):
    global presses
    presses += 1


button.irq(trigger=Pin.IRQ_FALLING, handler=on_press)

while True:
    print(presses)
    time.sleep(1)
