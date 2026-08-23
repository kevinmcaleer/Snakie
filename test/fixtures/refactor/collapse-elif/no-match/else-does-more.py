"""The `else:` holds more than the `if`, so `elif` cannot say the same thing."""


def stop_or_steer(rover, x, dead_zone):
    if abs(x) < dead_zone:
        rover.stop()
    else:
        rover.wake()
        if x > 0:
            rover.right(x)
        else:
            rover.left(-x)


def settle(imu, tolerance):
    if imu.ready():
        return imu.pitch()
    else:
        if imu.retry():
            return imu.pitch()
        return tolerance
