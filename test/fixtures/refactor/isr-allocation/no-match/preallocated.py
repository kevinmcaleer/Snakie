"""The same rover interrupts, written the way an ISR should be written.

Every buffer is allocated at import time; the handlers only move integers around
and hand the formatting to `micropython.schedule()`, which runs on the main
thread where the heap is available again.
"""
import micropython
import time
from machine import Pin

micropython.alloc_emergency_exception_buf(100)

TICK_SLOTS = 32
tick_us = bytearray(TICK_SLOTS)
tick_index = 0
stopped = False

left_encoder = Pin(16, Pin.IN, Pin.PULL_UP)
estop = Pin(19, Pin.IN, Pin.PULL_UP)


def report_tick(index):
    # Main thread: allocating here is fine.
    print("tick {} at {} us".format(index, tick_us[index]))


def on_left_tick(pin):
    global tick_index
    tick_us[tick_index] = time.ticks_us() & 0xFF
    tick_index = (tick_index + 1) % TICK_SLOTS
    micropython.schedule(report_tick, tick_index)


def on_estop(pin):
    global stopped
    stopped = True


left_encoder.irq(trigger=Pin.IRQ_RISING, handler=on_left_tick)
estop.irq(trigger=Pin.IRQ_FALLING, handler=on_estop)
