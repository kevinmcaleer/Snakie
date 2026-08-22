"""Sample the sensor rail and pick the readings worth keeping."""
from machine import ADC, Pin

CHANNELS = [ADC(Pin(26)), ADC(Pin(27)), ADC(Pin(28))]


def read_rail(channels):
    readings = [channel.read_u16() for channel in channels]
    return readings


def bright_pixels(frame, threshold):
    hits = [pixel for pixel in frame if pixel > threshold]
    return hits


def to_volts(samples):
    volts = [raw * 3.3 / 65535 for raw in samples]
    return volts


def servo_names(joints):
    names = [joint.name.upper() for joint in joints]
    return names
