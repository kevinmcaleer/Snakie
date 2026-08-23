"""A blocking sleep inside a coroutine.

This is a real bug — it stalls the whole event loop — but rule 39 owns it, and
`await asyncio.sleep()` is a better answer here than a hand-rolled tick check.
"""
import asyncio
import time
from machine import Pin

led = Pin(25, Pin.OUT)
beats = 0


async def heartbeat():
    global beats
    while True:
        led.toggle()
        beats = beats + 1
        print("beat", beats)
        time.sleep(0.5)


asyncio.run(heartbeat())
