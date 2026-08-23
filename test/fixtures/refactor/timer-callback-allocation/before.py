"""Telemetry timers for the rover — every callback here runs in IRQ context.

Three of the four allocate. The rule points at the allocation and explains; the
restructuring is a human decision, so this file is its own `after.py`.
"""
import micropython
import time
from machine import ADC, Pin, Timer

micropython.alloc_emergency_exception_buf(100)

battery = ADC(Pin(26))
samples = bytearray(64)
index = 0
log = []


def sample_battery(timer):
    # A list display every 10 ms; the heap will not survive the afternoon.
    log.append([time.ticks_ms(), battery.read_u16()])


def print_status(timer):
    # `.format()` builds a new string in interrupt context.
    print("sample {} of {}".format(index, len(samples)))


def store_sample(timer):
    # Safe: a buffer allocated at import time and integer arithmetic only.
    global index
    samples[index] = battery.read_u16() >> 8
    index = (index + 1) % len(samples)


sampler = Timer(-1)
sampler.init(period=10, mode=Timer.PERIODIC, callback=sample_battery)

status = Timer(-1)
status.init(period=1000, mode=Timer.PERIODIC, callback=print_status)

storer = Timer(period=5, mode=Timer.PERIODIC, callback=store_sample)

Timer(-1).init(
    period=250,
    mode=Timer.PERIODIC,
    callback=lambda t: print(f"uptime {time.ticks_ms()} ms"),
)
