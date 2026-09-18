# buckets: docstring, early return, .append(), with, trailing comment
import time

readings = []


def take(sensor):
    """Read the sensor and remember what it said.

    Returns None when the sensor is not ready yet, which happens for
    the first second or so after power-up.
    """
    value = sensor.read()
    if value is None:
        return None
    readings.append(value)
    return value


def average():
    if len(readings) == 0:
        return 0
    return sum(readings) / len(readings)  # plain mean, no smoothing


def write(path):
    with open(path, "w") as handle:
        for value in readings:
            handle.write("%.2f\n" % value)
