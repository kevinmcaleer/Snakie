"""Two-wheel rover: drive pattern, heartbeat LED and a battery watchdog."""
import uasyncio as asyncio
import time
from machine import ADC, Pin

battery = ADC(Pin(26))
led = Pin("LED", Pin.OUT)


async def heartbeat():
    while True:
        led.toggle()
        time.sleep(0.5)


async def drive_square(rover):
    for _ in range(4):
        rover.forward(0.6)
        time.sleep(1.2)  # one side of the square
        rover.turn_left(90)
        time.sleep_ms(400)
    rover.stop()


async def watch_battery():
    while True:
        volts = battery.read_u16() * 3.3 / 65535
        if volts < 3.4:
            print("battery low:", volts)
        # asyncio has no microsecond sleep, so this one is flagged, not fixed.
        time.sleep_us(500)
        time.sleep(2)


def calibrate(rover):
    # A plain def is not a coroutine — blocking here stalls nothing else.
    rover.forward(0.2)
    time.sleep(0.25)
    rover.stop()


async def main(rover):
    calibrate(rover)
    await asyncio.gather(heartbeat(), drive_square(rover), watch_battery())
