"""The branches differ by one argument, which is the whole point of the test."""


def pick_gear(load, gearbox):
    if load > 0.75:
        gearbox.select("low")
        gearbox.engage()
    else:
        gearbox.select("high")
        gearbox.engage()
