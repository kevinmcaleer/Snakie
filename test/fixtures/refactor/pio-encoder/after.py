"""Wheel odometry for a two-motor Pico rover, decoded in software.

Both decoders below are the shape PIO exists for: the left wheel counts edges
in an interrupt handler, the right wheel polls. The rule points at each of them
and explains what gets lost; the PIO program is the author's to write, so this
file is its own `after.py`.
"""
import time
from machine import Pin

# Gray-code transition table, indexed by (previous << 2) | current.
TRANSITIONS = (0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0)

left_a = Pin(2, Pin.IN, Pin.PULL_UP)
left_b = Pin(3, Pin.IN, Pin.PULL_UP)
right_a = Pin(4, Pin.IN, Pin.PULL_UP)
right_b = Pin(5, Pin.IN, Pin.PULL_UP)

left_state = 0
left_count = 0
right_count = 0

TICKS_PER_METRE = 1180


def on_left_edge(pin):
    """Fires on both edges of both left-hand channels."""
    global left_state, left_count
    a = left_a.value()
    b = left_b.value()
    left_state = ((left_state << 2) | (a << 1) | b) & 0x0F
    left_count += TRANSITIONS[left_state]


def track_right(seconds):
    """Poll the right-hand channels for a while and count the transitions."""
    global right_count
    last = (right_a.value() << 1) | right_b.value()
    deadline = time.ticks_add(time.ticks_ms(), int(seconds * 1000))
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        now = (right_a.value() << 1) | right_b.value()
        if now != last:
            if ((last << 1) ^ now) & 0x02:
                right_count += 1
            else:
                right_count -= 1
            last = now


def metres_travelled():
    return (left_count + right_count) / (2 * TICKS_PER_METRE)


left_a.irq(trigger=Pin.IRQ_RISING | Pin.IRQ_FALLING, handler=on_left_edge)
left_b.irq(trigger=Pin.IRQ_RISING | Pin.IRQ_FALLING, handler=on_left_edge)

track_right(2.0)
print("travelled", metres_travelled(), "m")
