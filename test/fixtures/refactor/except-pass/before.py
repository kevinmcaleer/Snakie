"""Rover housekeeping — the errors here go nowhere."""

import machine


def stop_all(motors):
    for motor in motors:
        try:
            motor.duty_u16(0)
        except:
            pass


def read_battery(adc):
    try:
        return adc.read_u16() * 3.3 / 65535
    except ValueError:
        pass
    return 0.0


def save_trip(path, metres):
    try:
        with open(path, "a") as f:
            f.write("%d\n" % metres)
    except OSError:
        pass
