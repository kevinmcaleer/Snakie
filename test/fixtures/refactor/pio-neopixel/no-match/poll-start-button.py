"""Wait for the rover's start button, polling every few microseconds.

Microsecond sleeps inside a loop, but the loop only *reads* a pin — there is no
pulse train being generated here, so there is nothing for PIO to clock.
"""
from machine import Pin
from time import sleep_us, ticks_ms

start_button = Pin(12, Pin.IN, Pin.PULL_UP)
ready_led = Pin(25, Pin.OUT)


def wait_for_start():
    ready_led.on()
    while start_button.value() == 1:
        sleep_us(5)
    ready_led.off()
    return ticks_ms()


started_at = wait_for_start()
print("run started at", started_at)
