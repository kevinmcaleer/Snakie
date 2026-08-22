"""Line-follower helpers for the Pico rover."""

from machine import Pin


def arm(rover, ready):
    if ready:
        rover.enable()
    while rover.stalled:
        rover.step()


def read_line(sensor=None):
    if sensor is None:
        return -1
    if not sensor.calibrated:
        sensor.calibrate()
    if not sensor.enabled:
        sensor.enable()
    return sensor.read_u16()


def status(bus, fault):
    # `!= None` is the wrong idiom even where truthiness is not the question.
    connected = bus.handle is not None
    if connected and not fault:
        return "ok"
    return "fault"


def dropped(rows):
    return [r for r in rows if not r.dropped]


def latch(pin_no, active_high):
    led = Pin(pin_no, Pin.OUT)
    # Not a condition: the comparison's own value is what gets stored.
    led.inverted = active_high == False
    return led
