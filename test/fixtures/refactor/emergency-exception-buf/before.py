"""Bumper and encoder interrupts, with no traceback safety net."""
from machine import Pin
import time

left_encoder = Pin(16, Pin.IN, Pin.PULL_UP)
bumper = Pin(18, Pin.IN, Pin.PULL_UP)

ticks = 0
bumped = False


def on_tick(pin):
    global ticks
    ticks += 1


def on_bump(pin):
    global bumped
    bumped = True


left_encoder.irq(trigger=Pin.IRQ_RISING, handler=on_tick)
bumper.irq(trigger=Pin.IRQ_FALLING, handler=on_bump)

while True:
    if bumped:
        bumped = False
        print("bumped after", ticks, "ticks")
    time.sleep_ms(100)
