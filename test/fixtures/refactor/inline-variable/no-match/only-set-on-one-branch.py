"""The assignment is conditional; the reader is not, so the name has to stay."""


def target_speed(boost, cruise):
    speed = cruise
    if boost:
        speed = cruise * 2
    return speed
