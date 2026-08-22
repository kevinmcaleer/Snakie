"""Map the battery level and the joystick onto rover behaviour."""

GREEN = (0, 32, 0)
AMBER = (32, 24, 0)
RED = (32, 0, 0)
OFF = (0, 0, 0)
DEAD_ZONE = 8


def mode_for(x):
    if abs(x) < DEAD_ZONE:
        return "idle"
    elif x > 0:
        return "right"
    else:
        return "left"


def led_colour(level):
    if level > 80:
        return GREEN
    elif level > 40:
        return AMBER
    elif level > 10:
        return RED
    else:
        return OFF


def clamp_duty(duty):
    if duty < 0:
        return 0
    elif duty > 65535:
        # The PWM peripheral wraps rather than saturating.
        return 65535
    else:
        return duty
