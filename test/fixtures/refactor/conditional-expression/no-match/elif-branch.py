"""The last two branches match the shape — but they belong to an `elif` chain."""


def gear(speed, load):
    if speed > 60:
        ratio = 3
    elif load > 10:
        ratio = 2
    else:
        ratio = 1
    return ratio
