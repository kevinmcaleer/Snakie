"""`time` here is the caller's clock object, not the module.

`import time` sits at the top of the file, so the dotted call looks like the real
thing — but inside `run()` the name belongs to the parameter, and that object's
`sleep()` is its own. Writing `time.ticks_diff(time.ticks_ms(), …)` into the loop
would call two methods it has never heard of. The plain spelling is only worth
trusting while nothing in the file binds it to something else.
"""
import time
from machine import Pin

led = Pin(25, Pin.OUT)


def run(time):
    while True:
        led.toggle()
        print("tick")
        time.sleep(0.1)


run(time)
