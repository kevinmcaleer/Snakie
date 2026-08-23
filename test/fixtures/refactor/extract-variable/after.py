"""Duty-cycle helpers for the rover's steering servo."""

MIN_DUTY = 1638
MAX_DUTY = 8192
TRIM = 3


def duty_for(angle):
    value = MIN_DUTY + (MAX_DUTY - MIN_DUTY) * angle // 180
    if value > MAX_DUTY:
        raise ValueError("angle out of range")
    return value


def steer(left):
    value = left * 655 + TRIM
    pwm_left.duty_u16(value)
    log("left", value)


def calibrate(samples):
    total = 0
    for raw in samples:
        value = raw * 3300 // 65535
        total += value
        print(value)
    return total
