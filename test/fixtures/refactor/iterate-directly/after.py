"""Sensor and pixel helpers for the rover."""


def brightest(readings):
    best = 0
    for reading in readings:
        if reading > best:
            best = reading
    return best


def show(pixels, strip):
    for i, pixel in enumerate(pixels):
        # The strip wants the channel number as well as the colour.
        strip.set_pixel(i, pixel)
    strip.write()


class Rover:
    def stop_all(self):
        for motor in self.motors:
            motor.duty_u16(0)
