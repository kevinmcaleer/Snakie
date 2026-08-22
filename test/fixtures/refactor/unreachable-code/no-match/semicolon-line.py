"""The dead call shares its line with the live `return`, so whole-line
deletion would take the `return` with it."""


def stop_all(motors, log):
    for motor in motors:
        motor.duty(0)
    return True; log("stopped")
