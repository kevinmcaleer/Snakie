"""The file already means something else by `ticks_ms`.

This `sleep` really is the blocking one, so the hint stands — but the guard the
rewrite would write needs a bare `ticks_ms()`, and in this function that name is
an integer the loop keeps its own count in. Emitting the call anyway would swap
a working delay for a `TypeError: 'int' object is not callable` on the first
pass, so `apply` declines and offers no rewrite.
"""
from time import sleep
from machine import Pin

led = Pin(25, Pin.OUT)


def run():
    ticks_ms = 0
    while True:
        led.toggle()
        print("passes so far", ticks_ms)
        sleep(1)
