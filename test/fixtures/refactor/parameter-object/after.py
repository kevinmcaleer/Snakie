"""Drive setup for the six-wheeled rover."""

from machine import PWM, Pin


def configure_drive(left_pin, right_pin, freq, min_duty, max_duty, deadband):
    """Bring both drive channels up and hand back the live PWM pair."""
    left = PWM(Pin(left_pin))
    right = PWM(Pin(right_pin))
    left.freq(freq)
    right.freq(freq)
    left.duty_u16(min_duty + deadband)
    right.duty_u16(max_duty - deadband)
    return left, right


class Rover:
    def calibrate(self, wheel_base, wheel_radius, gear_ratio, ticks, max_rpm, trim):
        self.scale = wheel_radius * gear_ratio / ticks
        self.turn_scale = self.scale / wheel_base
        self.limit = max_rpm
        self.trim = trim
