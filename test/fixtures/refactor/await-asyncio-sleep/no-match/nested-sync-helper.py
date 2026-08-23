"""The blocking sleeps here all sit in synchronous code, one nested in a task.

A `def` inside an `async def` is still an ordinary function: it blocks its own
caller when that caller runs it, and the enclosing coroutine is not what decides
that. The stored `time.sleep` reference is not a call at all.
"""
import asyncio
import time
from machine import Pin

buzzer = Pin(14, Pin.OUT)
pause = time.sleep


async def alarm(pattern):
    def beep(ms):
        buzzer.value(1)
        time.sleep_ms(ms)
        buzzer.value(0)

    for ms in pattern:
        beep(ms)
        await asyncio.sleep_ms(ms)


def self_test():
    buzzer.value(1)
    pause(0.1)
    buzzer.value(0)
