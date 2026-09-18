# buckets: async def, await, method call on an object
import uasyncio as asyncio
from machine import Pin

led = Pin(25, Pin.OUT)


async def blink(period):
    while True:
        led.toggle()
        await asyncio.sleep(period)


async def main():
    await asyncio.gather(blink(0.2), blink(0.7))


asyncio.run(main())
