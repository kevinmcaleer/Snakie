"""Printing once, before and after the work, costs nothing worth flagging."""

from machine import ADC, Pin
from time import sleep_ms

pot = ADC(Pin(26))


def calibrate(samples):
    print("calibrating…")
    total = 0
    for _ in range(samples):
        total += pot.read_u16()
        sleep_ms(5)
    average = total // samples
    print("centre is", average)
    return average
