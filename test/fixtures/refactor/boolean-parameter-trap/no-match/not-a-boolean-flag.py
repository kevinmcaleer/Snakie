"""Defaults that are not booleans, and a boolean that is never the whole test."""


def travel(motors, distance, direction=1):
    if direction:
        motors.run(distance)
    else:
        motors.run(-distance)


def sample(sensor, window=None):
    if window:
        return sensor.average(window)
    else:
        return sensor.read()


def report(radio, battery, verbose=True):
    if verbose and radio.connected:
        radio.send("battery {}%".format(battery))
    else:
        radio.send(str(battery))
