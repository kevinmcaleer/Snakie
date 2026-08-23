"""The later candidates are only reached when the earlier test fails. A tuple
builds every member first, so folding these would read the hardware every time."""


def at_target(value, sensor):
    return value == 0 or value == sensor.read()


def door_changed(state, switch):
    if state != "open" and state != switch.state():
        return True
    return False
