"""Built inside an `if`: hoisting would touch hardware the code chose to avoid."""

from machine import Pin
from time import sleep_ms


def beep_on_fault(flags):
    for flag in flags:
        if flag:
            buzzer = Pin(18, Pin.OUT)
            buzzer.value(1)
            sleep_ms(20)
            buzzer.value(0)
        sleep_ms(5)
