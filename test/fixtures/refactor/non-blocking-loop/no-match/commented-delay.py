"""Two sleeps whose comment explains the delay.

The sleep line is deleted by the rewrite. A comment on the line above it or the
line below it is a comment about that delay, and it would be left behind
explaining a wait that no longer exists — pointing at code that means something
else now. That is the same reason a comment sharing the sleep's own line stands
the rule down.
"""
import time
from machine import ADC, Pin

light = ADC(26)
led = Pin(25, Pin.OUT)


def sample_slowly():
    while True:
        led.toggle()
        print("light", light.read_u16())
        # give the LDR a moment to settle after the LED changes
        time.sleep(0.2)


def blink_slowly():
    while True:
        led.on()
        led.off()
        time.sleep(1)
        # once a second is easy on the eye
