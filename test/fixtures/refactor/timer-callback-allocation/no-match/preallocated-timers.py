"""The same telemetry, written so the callbacks never touch the heap.

The ring buffer is allocated at import time, the callbacks only move integers
into it, and anything that needs a string is handed to `micropython.schedule()`
to run back on the main thread.
"""
import micropython
import time
from machine import ADC, Pin, Timer

micropython.alloc_emergency_exception_buf(100)

battery = ADC(Pin(26))
samples = bytearray(64)
index = 0
overruns = 0


def report(count):
    # Main thread: allocating a string here is fine.
    print("stored {} samples, {} overruns".format(count, overruns))


def store_sample(timer):
    global index
    samples[index] = battery.read_u16() >> 8
    index = (index + 1) % len(samples)
    if index == 0:
        micropython.schedule(report, len(samples))


def feed_watchdog(timer):
    global overruns
    overruns += 1


sampler = Timer(-1)
sampler.init(period=10, mode=Timer.PERIODIC, callback=store_sample)

watchdog = Timer(period=500, mode=Timer.PERIODIC, callback=feed_watchdog)
