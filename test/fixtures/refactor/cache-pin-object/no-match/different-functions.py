"""The same pin in two functions: who owns it is the author's decision."""

from machine import Pin


def led_on():
    Pin(25, Pin.OUT).value(1)


def led_off():
    Pin(25, Pin.OUT).value(0)
