"""Motor mixing for the two-wheel rover."""

MAX_DUTY = 65535


def clamp(speed, limit):
    target = limit if speed > limit else speed
    return target


def heading(joystick):
    label = "reverse" if joystick.y < 0 else "forward"
    return label


def configure(rover, fast):
    rover.cruise = 900 if fast else 400
    return rover


def blend(channels, boost, left):
    channels["left"] = left * 2 if boost else left
    return channels


def duty(speed):
    raw = int(MAX_DUTY * speed) if speed else 0
    return min(raw, MAX_DUTY)
