"""Motor mixing for the two-wheel rover."""

MAX_DUTY = 65535


def clamp(speed, limit):
    if speed > limit:
        target = limit
    else:
        target = speed
    return target


def heading(joystick):
    if joystick.y < 0:
        label = "reverse"
    else:
        label = "forward"
    return label


def configure(rover, fast):
    if fast:
        rover.cruise = 900
    else:
        rover.cruise = 400
    return rover


def blend(channels, boost, left):
    if boost:
        channels["left"] = left * 2
    else:
        channels["left"] = left
    return channels


def duty(speed):
    if speed:
        raw = int(MAX_DUTY * speed)
    else:
        raw = 0
    return min(raw, MAX_DUTY)
