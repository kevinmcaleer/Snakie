"""Bump-and-turn rover loop for the Pico."""
import time
from machine import Pin
from time import ticks_ms, sleep_ms

BUMPER = Pin(14, Pin.IN, Pin.PULL_UP)
led = Pin(25, Pin.OUT)


def wait_for_bump(timeout_ms):
    """True when the bumper closes before the timeout runs out."""
    start = ticks_ms()
    while ticks_ms() - start < timeout_ms:
        if BUMPER.value() == 0:
            return True
        sleep_ms(5)
    return False


def blink(period_ms, passes):
    last = time.ticks_ms()
    for _ in range(passes):
        if time.ticks_ms() - last > period_ms:  # heartbeat
            led.toggle()
            last = time.ticks_ms()


def settle_time(sensor):
    t0 = time.ticks_us()
    sensor.read()
    return time.ticks_us() - t0
