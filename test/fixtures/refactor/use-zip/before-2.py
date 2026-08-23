"""Names that suggest no singular, and one the scope has already taken."""


def merge(data, meta):
    for i in range(len(data)):
        print(data[i], meta[i])


def describe(sensors, labels):
    sensor = None
    for i in range(len(sensors)):
        print(sensors[i], labels[i])
    return sensor
