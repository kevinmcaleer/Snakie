"""Sensor helpers."""


def read_sensor(bus):
    if bus is not None:
        raw = bus.read()
        scaled = raw / 16
        return scaled


def drive(motor, speed):
    """Spin the motor, if we have one."""
    if motor:
        # Clamp before we touch the hardware.
        speed = min(max(speed, -100), 100)
        motor.duty(speed)
        return speed


def report(values):
    if not values:
        print("nothing to report")
        return None


def calibrate(sensor, tries=3):
    if sensor.ready and tries > 0:
        base = sensor.read()
        for _ in range(tries):
            base = (base + sensor.read()) / 2
        return base


def de_morgan(mode, count):
    if mode == "run" and count > 0:
        start(mode)
        tick(count)
        return True
