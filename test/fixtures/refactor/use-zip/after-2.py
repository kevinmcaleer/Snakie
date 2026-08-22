"""Names that suggest no singular, and one the scope has already taken."""


def merge(data, meta):
    for first, second in zip(data, meta):
        print(first, second)


def describe(sensors, labels):
    sensor = None
    for sensor2, label in zip(sensors, labels):
        print(sensor2, label)
    return sensor
