# Both values already have a name, so there is nothing left to teach: one is
# wrapped in const(), the other is a plain ALL_CAPS module constant.
from micropython import const
from machine import PWM, Pin

PWM_FREQ = const(1000)
STALL_CURRENT_MA = 1200


def arm(pin):
    motor = PWM(Pin(pin), freq=1000)
    motor.duty_u16(0)
    return motor


def stalled(reading):
    return reading > 1200
