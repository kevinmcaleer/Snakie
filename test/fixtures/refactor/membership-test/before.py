"""Command dispatch for the rover's serial console."""


def handle(command, motors):
    if command == "stop" or command == "halt":
        motors.brake()
        return True
    return False


def is_axis(name):
    return name == "x" or name == "y" or name == "z"


def check_status(code):
    if code != 200 and code != 204:
        raise OSError(code)


def settle(sensor):
    while sensor.mode != "idle" and sensor.mode != "ready":
        sleep_ms(20)
    return sensor.mode
