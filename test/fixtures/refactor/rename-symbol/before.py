# Line follower — the rename rule is selection-driven, so a run with no cursor
# offers nothing at all and this file comes back byte for byte unchanged.
from machine import Pin, PWM
import time

LEFT_EYE = Pin(16, Pin.IN)
RIGHT_EYE = Pin(17, Pin.IN)


def follow_line(left, right, motor):
    """Nudge the motor until both sensors sit over the line."""
    motorSpeed = 40
    lastError = 0
    for _ in range(200):
        error = left.value() - right.value()
        motorSpeed += (error - lastError) * 2
        lastError = error
        motor.duty_u16(min(max(motorSpeed, 0), 65535))
        time.sleep_ms(20)
    return motorSpeed


def main():
    motor = PWM(Pin(18))
    motor.freq(1000)
    follow_line(LEFT_EYE, RIGHT_EYE, motor)


main()
