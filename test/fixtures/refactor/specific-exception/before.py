"""Boot-time helpers for the rover."""

import machine

i2c = machine.I2C(0, scl=machine.Pin(5), sda=machine.Pin(4))


def load_config(path):
    try:
        with open(path) as f:
            return f.read()
    except:
        return "{}"


def find_devices():
    try:
        return i2c.scan()
    except:
        return []


def trim_from(raw):
    try:
        return int(raw) / 100
    except:
        return 0.0


def shutdown(motors):
    for motor in motors:
        try:
            motor.duty_u16(0)
        except:
            print("motor would not stop")
