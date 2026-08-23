"""Pin map and tuning values for the line-following rover."""

from machine import Pin, PWM
from micropython import const

LEFT_MOTOR_PIN = const(16)
RIGHT_MOTOR_PIN = const(17)
PWM_FREQ = const(1000)
LINE_THRESHOLD = const(0x1F)
FULL_DUTY = const(65_535)
STEERING_GAIN = 1.5
DRIVE_MODE = "cruise"

left = PWM(Pin(LEFT_MOTOR_PIN))
right = PWM(Pin(RIGHT_MOTOR_PIN))


def start():
    left.freq(PWM_FREQ)
    right.freq(PWM_FREQ)


def cruise(speed):
    duty = min(int(speed * STEERING_GAIN), FULL_DUTY)
    left.duty_u16(duty)
    right.duty_u16(duty)
    return duty
