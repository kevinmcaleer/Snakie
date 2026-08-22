"""Sensor helpers."""


def read_sensor(bus):
    if bus is None:
        return
    raw = bus.read()
    scaled = raw / 16
    return scaled


def drive(motor, speed):
    """Spin the motor, if we have one."""
    if not motor:
        return
    # Clamp before we touch the hardware.
    speed = min(max(speed, -100), 100)
    motor.duty(speed)
    return speed


def report(values):
    if values:
        return
    print("nothing to report")
    return None


def calibrate(sensor, tries=3):
    if not (sensor.ready and tries > 0):
        return
    base = sensor.read()
    for _ in range(tries):
        base = (base + sensor.read()) / 2
    return base


def de_morgan(mode, count):
    if mode != "run" or count <= 0:
        return
    start(mode)
    tick(count)
    return True
