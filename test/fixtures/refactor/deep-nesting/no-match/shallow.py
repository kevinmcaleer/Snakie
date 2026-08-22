"""Three levels is still readable — this must not be flagged."""


def sweep(servo, sensors, log):
    for angle in range(0, 181, 10):
        servo.write(angle)
        for sensor in sensors:
            if sensor.ready:
                log.append((angle, sensor.read()))
