"""Drive a table of servos held in a dictionary."""


def stop_all(servos):
    for name, value in servos.items():
        value.detach()


def show(config):
    for key in config:
        print(key)


def report(limits):
    for joint in limits:
        low, high = limits[joint]
        print(joint, low, high)


class Rig:
    def centre(self):
        for pin, value in self.servos.items():
            value.write_angle(90)
