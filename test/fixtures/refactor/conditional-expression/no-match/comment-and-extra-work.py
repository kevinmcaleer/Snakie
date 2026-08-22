"""A comment would be folded away, and a branch that does two things can't fold."""


def pick_baud(fast):
    if fast:
        # The bus tops out here through a 3.3 V level shifter.
        baud = 400_000
    else:
        baud = 100_000
    return baud


def start(motor, reverse):
    if reverse:
        motor.direction = 1
        motor.duty = 300
    else:
        motor.direction = 0
    return motor


def latch(pin, active):
    if active:
        state = 1
    else:
        state = 0
        pin.off()
    return state
