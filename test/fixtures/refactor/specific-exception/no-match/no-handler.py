"""try/finally and try/else — no handler to narrow."""

import machine


def sample(adc, log_path):
    f = open(log_path, "a")
    try:
        reading = adc.read_u16()
        f.write("%d\n" % reading)
        return reading
    finally:
        f.close()


def reset_bus(pin_number):
    pin = machine.Pin(pin_number, machine.Pin.OUT)
    try:
        pin.value(0)
    except OSError:
        return False
    else:
        pin.value(1)
        return True
