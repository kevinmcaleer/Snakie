"""Drive a table of servos held in a dictionary."""


def stop_all(servos):
    for name in servos.keys():
        servos[name].detach()


def show(config):
    for key in config.keys():
        print(key)


def report(limits):
    for joint in limits.keys():
        low, high = limits[joint]
        print(joint, low, high)


class Rig:
    def centre(self):
        for pin in self.servos.keys():
            self.servos[pin].write_angle(90)
