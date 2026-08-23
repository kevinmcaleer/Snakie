"""Calibration helpers for the rover's sensor bus."""


def blend(readings, gains):
    out = []
    for i in range(len(readings)):
        out.append(readings[i] * gains[i])
    return out


def report(names, temperatures, pressures):
    for i in range(len(names)):
        print(names[i], temperatures[i], pressures[i])


class Rig:
    def __init__(self, motors, encoders):
        self.motors = motors
        self.encoders = encoders

    def sync(self):
        for i in range(len(self.motors)):
            self.motors[i].set_speed(self.encoders[i].rate)
