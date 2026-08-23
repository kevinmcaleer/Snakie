"""Sample the sensor rail and pick the readings worth keeping."""
from machine import ADC, Pin

CHANNELS = [ADC(Pin(26)), ADC(Pin(27)), ADC(Pin(28))]


def read_rail(channels):
    readings = []
    for channel in channels:
        readings.append(channel.read_u16())
    return readings


def bright_pixels(frame, threshold):
    hits = []
    for pixel in frame:
        if pixel > threshold:
            hits.append(pixel)
    return hits


def to_volts(samples):
    volts = []
    for raw in samples:
        volts.append(raw * 3.3 / 65535)
    return volts


def servo_names(joints):
    names = []
    for joint in joints:
        names.append(joint.name.upper())
    return names
