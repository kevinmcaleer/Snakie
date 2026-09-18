# buckets: tuple assign, augmented assign beyond +=, subscript assign, in
readings = [0] * 8

low = 65535
high = 0


def sample(sensor):
    global low, high
    total = 0
    for index in range(len(readings)):
        value = sensor.read_u16()
        readings[index] = value
        total += value
        if value < low:
            low = value
        if value > high:
            high = value
    total //= len(readings)
    return total


def scale(value):
    span = high - low
    if span == 0:
        return 0
    value -= low
    value *= 100
    return value / span
