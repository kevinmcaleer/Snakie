"""Servo and telemetry helpers for the rover."""

MIN_DUTY = 1638
MAX_DUTY = 8192


def duty_for(angle):
    span = MAX_DUTY - MIN_DUTY
    return MIN_DUTY + span * angle // 180


def to_fahrenheit(temp_c):
    scaled = temp_c * 9 / 5 + 32
    print("temp", scaled)


def is_safe(armed, docked, battery):
    healthy = armed and not docked
    if healthy:
        return battery > 20
    return False
