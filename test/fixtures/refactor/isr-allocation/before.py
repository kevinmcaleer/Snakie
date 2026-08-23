"""Wheel-encoder, bumper and e-stop interrupts on a Pico rover.

Three of the four handlers below allocate in interrupt context. The rule points
at the allocation and explains; the restructuring is left to a human, so this
file is its own `after.py`.
"""
import micropython
import time
from machine import Pin

micropython.alloc_emergency_exception_buf(100)

left_encoder = Pin(16, Pin.IN, Pin.PULL_UP)
right_encoder = Pin(17, Pin.IN, Pin.PULL_UP)
bumper = Pin(18, Pin.IN, Pin.PULL_UP)
estop = Pin(19, Pin.IN, Pin.PULL_UP)

events = []
stopped = False


def on_left_tick(pin):
    # A dict display asks the allocator for memory on every single edge.
    events.append({"wheel": "left", "us": time.ticks_us()})


def on_right_tick(pin):
    # An f-string builds a brand-new string in interrupt context.
    print(f"right tick at {time.ticks_us()}")


def on_estop(pin):
    # Safe: one flag, then hand the work to the scheduler.
    global stopped
    stopped = True
    micropython.schedule(report_stop, pin)


def report_stop(pin):
    # Runs back on the main thread, where allocating is perfectly fine.
    print("emergency stop from {}".format(pin))


left_encoder.irq(trigger=Pin.IRQ_RISING, handler=on_left_tick)
right_encoder.irq(on_right_tick, Pin.IRQ_RISING)
estop.irq(trigger=Pin.IRQ_FALLING, handler=on_estop)
bumper.irq(lambda pin: print("bump on " + str(pin)), Pin.IRQ_FALLING)
