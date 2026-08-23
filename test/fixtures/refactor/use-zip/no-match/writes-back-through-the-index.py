"""These loops assign through the index, which a `zip` variable cannot do."""


def normalise(readings, offsets):
    for i in range(len(readings)):
        readings[i] = readings[i] - offsets[i]


def arm(channels, duties):
    for i in range(len(channels)):
        channels[i].duty = duties[i]
