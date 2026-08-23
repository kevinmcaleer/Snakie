"""Start-up configuration for the rover."""

DEFAULT_TRIM = 0
PIN_NAMES = {"left": 16, "right": 17}


def setting(config, name):
    if name in config:
        value = config[name]
    else:
        value = 0
    return value


def pin_for(label):
    if label not in PIN_NAMES:
        number = -1
    else:
        number = PIN_NAMES[label]
    return number


def apply_trim(config, servo):
    if "trim" in config:
        offset = config["trim"]
    else:
        offset = DEFAULT_TRIM
    servo.write_us(1500 + offset)


class Rover:
    def speed_limit(self):
        if self.mode in self.limits:
            limit = self.limits[self.mode]
        else:
            limit = 100
        return limit
