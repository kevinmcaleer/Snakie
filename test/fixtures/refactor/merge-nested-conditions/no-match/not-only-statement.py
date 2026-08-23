def sweep(servo, angle, journal):
    if servo.attached:
        journal.append(angle)
        if 0 <= angle <= 180:
            servo.write(angle)
            servo.settle()


def home(axis, limit):
    if axis.enabled:
        if limit.value() == 0:
            axis.step(-1)
            axis.settle()
        axis.zero()
