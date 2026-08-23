"""Already on the event loop properly — nothing left to fix here."""
import asyncio
from machine import Pin

led = Pin("LED", Pin.OUT)


async def heartbeat():
    while True:
        led.toggle()
        await asyncio.sleep(0.5)


async def sample(sensor, period_ms=100):
    while True:
        print(sensor.read())
        await asyncio.sleep_ms(period_ms)


async def main(sensor):
    await asyncio.gather(heartbeat(), sample(sensor))
