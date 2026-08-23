"""Every module imports the same things — that is not duplication worth naming."""


def load_sensors():
    import time
    import machine
    import network
    return machine.I2C(0)


def load_radio():
    import time
    import machine
    import network
    return network.WLAN()
