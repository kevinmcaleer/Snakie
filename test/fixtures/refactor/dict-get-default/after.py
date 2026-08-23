"""Start-up configuration for the rover."""

DEFAULT_TRIM = 0
PIN_NAMES = {"left": 16, "right": 17}


def setting(config, name):
    value = config.get(name, 0)
    return value


def pin_for(label):
    number = PIN_NAMES.get(label, -1)
    return number


def apply_trim(config, servo):
    offset = config.get("trim", DEFAULT_TRIM)
    servo.write_us(1500 + offset)


class Rover:
    def speed_limit(self):
        limit = self.limits.get(self.mode, 100)
        return limit
