"""Command dispatch for the rover's serial console."""


def handle(command, motors):
    if command in ("stop", "halt"):
        motors.brake()
        return True
    return False


def is_axis(name):
    return name in ("x", "y", "z")


def check_status(code):
    if code not in (200, 204):
        raise OSError(code)


def settle(sensor):
    while sensor.mode not in ("idle", "ready"):
        sleep_ms(20)
    return sensor.mode
