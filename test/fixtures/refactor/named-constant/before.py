"""Line-following rover for the Snakie chassis."""

import time
from machine import ADC, PWM, Pin

left = PWM(Pin(14), freq=1000)
right = PWM(Pin(15), freq=1000)
line_sensor = ADC(Pin(26))


class Rover:
    def __init__(self):
        self.mode = "cruise"
        self.cruise_duty = 48000

    def reset(self):
        self.mode = "cruise"
        self.cruise_duty = 48000

    def on_the_line(self):
        reading = line_sensor.read_u16()
        return reading > 42000

    def follow(self, steps):
        for _ in range(steps):
            reading = line_sensor.read_u16()
            if reading > 42000:
                left.duty_u16(self.cruise_duty)
            else:
                right.duty_u16(self.cruise_duty)
            time.sleep_ms(20)
