"""Calibration helpers for the rover's sensor bus."""


def blend(readings, gains):
    out = []
    for reading, gain in zip(readings, gains):
        out.append(reading * gain)
    return out


def report(names, temperatures, pressures):
    for name, temperature, pressure in zip(names, temperatures, pressures):
        print(name, temperature, pressure)


class Rig:
    def __init__(self, motors, encoders):
        self.motors = motors
        self.encoders = encoders

    def sync(self):
        for motor, encoder in zip(self.motors, self.encoders):
            motor.set_speed(encoder.rate)
