"""Duty-cycle helpers for the rover's steering servo."""

MIN_DUTY = 1638
MAX_DUTY = 8192
TRIM = 3


def duty_for(angle):
    if MIN_DUTY + (MAX_DUTY - MIN_DUTY) * angle // 180 > MAX_DUTY:
        raise ValueError("angle out of range")
    return MIN_DUTY + (MAX_DUTY - MIN_DUTY) * angle // 180


def steer(left):
    pwm_left.duty_u16(left * 655 + TRIM)
    log("left", left * 655 + TRIM)


def calibrate(samples):
    total = 0
    for raw in samples:
        total += raw * 3300 // 65535
        print(raw * 3300 // 65535)
    return total
