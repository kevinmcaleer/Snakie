"""Sensor and pixel helpers for the rover."""


def brightest(readings):
    best = 0
    for i in range(len(readings)):
        if readings[i] > best:
            best = readings[i]
    return best


def show(pixels, strip):
    for i in range(len(pixels)):
        # The strip wants the channel number as well as the colour.
        strip.set_pixel(i, pixels[i])
    strip.write()


class Rover:
    def stop_all(self):
        for i in range(len(self.motors)):
            self.motors[i].duty_u16(0)
