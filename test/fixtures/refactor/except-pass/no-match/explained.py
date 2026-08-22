"""A pass someone wrote a reason for is a decision, not an oversight."""

import uos
from machine import I2C, Pin

display_bus = I2C(0, scl=Pin(5), sda=Pin(4))


def show(text):
    try:
        display_bus.writeto(0x3C, text.encode())
    except OSError:
        # The OLED is optional on this build; carry on headless.
        pass


def unmount(path):
    try:
        uos.umount(path)
    except OSError:
        pass  # already unmounted, which is the state we wanted
