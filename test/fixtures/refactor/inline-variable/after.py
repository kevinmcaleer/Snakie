"""Servo and telemetry helpers for the rover."""

MIN_DUTY = 1638
MAX_DUTY = 8192


def duty_for(angle):
    return MIN_DUTY + (MAX_DUTY - MIN_DUTY) * angle // 180


def to_fahrenheit(temp_c):
    print("temp", temp_c * 9 / 5 + 32)


def is_safe(armed, docked, battery):
    if armed and not docked:
        return battery > 20
    return False
