"""Line-following rover for the Snakie chassis."""

import time
from machine import ADC, PWM, Pin

PWM_FREQ = 1000
CRUISE_MODE = "cruise"
CRUISE_DUTY = 48000
READING_MAX = 42000

left = PWM(Pin(14), freq=PWM_FREQ)
right = PWM(Pin(15), freq=PWM_FREQ)
line_sensor = ADC(Pin(26))


class Rover:
    def __init__(self):
        self.mode = CRUISE_MODE
        self.cruise_duty = CRUISE_DUTY

    def reset(self):
        self.mode = CRUISE_MODE
        self.cruise_duty = CRUISE_DUTY

    def on_the_line(self):
        reading = line_sensor.read_u16()
        return reading > READING_MAX

    def follow(self, steps):
        for _ in range(steps):
            reading = line_sensor.read_u16()
            if reading > READING_MAX:
                left.duty_u16(self.cruise_duty)
            else:
                right.duty_u16(self.cruise_duty)
            time.sleep_ms(20)
