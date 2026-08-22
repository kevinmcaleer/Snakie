"""Bumper and status-LED helpers for the rover chassis."""

import machine
from machine import Pin
from time import sleep_ms


def read_bumpers():
    left = Pin(14, Pin.IN, Pin.PULL_UP).value()
    right = Pin(15, Pin.IN, Pin.PULL_UP).value()
    front = Pin(14, Pin.IN, Pin.PULL_UP).value()
    return left, right, front


def flash_status(times):
    for _ in range(times):
        machine.Pin(25, machine.Pin.OUT).value(1)
        sleep_ms(100)
        machine.Pin(25, machine.Pin.OUT).value(0)
        sleep_ms(100)
