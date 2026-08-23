"""Two loops whose `sleep` did not come from `time`.

`from time import sleep` is right there at the top, which is exactly what makes
this dangerous: inside `run()` the name belongs to the parameter, and inside
`paced()` to a local. Both calls are somebody else's pacing code. The rewrite
deletes the line it fires on, so reading these as a blocking delay would quietly
drop a step out of the program — and a module-level scan for the binding never
sees a parameter or a function local at all.
"""
from time import sleep
from machine import Pin

led = Pin(25, Pin.OUT)
motor = Pin(16, Pin.OUT)


def run(sleep):
    while True:
        led.toggle()
        motor.on()
        sleep(1)


def paced(pacer):
    sleep = pacer.wait
    while True:
        led.toggle()
        motor.off()
        sleep(2)


run(sleep)
