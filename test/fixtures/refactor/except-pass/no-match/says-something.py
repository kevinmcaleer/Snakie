"""Handlers that do something with the error."""

import sys


def calibrate(imu):
    try:
        imu.calibrate()
    except OSError as err:
        print("no IMU on the bus:", err)


def save_route(path, points):
    try:
        with open(path, "w") as f:
            for point in points:
                f.write("%s,%s\n" % point)
    except OSError:
        sys.print_exception(sys.exc_info()[1])
        raise


def start(motors):
    try:
        for motor in motors:
            motor.duty_u16(30000)
    except Exception:
        for motor in motors:
            motor.duty_u16(0)
        raise
