"""Every function here fits on a screen, so none of them is reported."""

from machine import PWM, Pin

MAX_DUTY = 65535


def clamp(value, low, high):
    if value < low:
        return low
    if value > high:
        return high
    return value


def drive(motor, percent):
    # Percent in, duty cycle out.
    duty = clamp(percent, -100, 100) * MAX_DUTY // 100
    motor.duty_u16(abs(duty))
    return duty


def stop(motors):
    for motor in motors:
        motor.duty_u16(0)
