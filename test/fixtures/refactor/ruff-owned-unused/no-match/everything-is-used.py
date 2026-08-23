"""Nothing unused here — and this rule would say nothing either way."""

import time
from machine import ADC, Pin


def follow(left_sensor, right_sensor, motors, period_ms):
    left = ADC(Pin(left_sensor))
    right = ADC(Pin(right_sensor))
    while True:
        error = left.read_u16() - right.read_u16()
        motors.steer(error // 512)
        time.sleep_ms(period_ms)
