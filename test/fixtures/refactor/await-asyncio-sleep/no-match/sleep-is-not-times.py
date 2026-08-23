"""Two ways a bare `sleep(...)` is NOT the blocking one from `time`.

`from uasyncio import sleep_ms` binds the coroutine to that name, and the class
below defines a `sleep` of its own that parks the motors. Rewriting either into
`await asyncio.sleep(...)` would change what the code does.
"""
from uasyncio import sleep_ms
from machine import Pin

standby = Pin(20, Pin.OUT)


class Drive:
    def __init__(self, left, right):
        self.left = left
        self.right = right

    def sleep(self, level=0):
        self.left.duty_u16(level)
        self.right.duty_u16(level)
        standby.value(0)


async def coast(drive):
    drive.sleep()
    sleep_ms(250)
    standby.value(1)
