"""Streaming to a UART and an OLED — neither of those is flash."""
import time
from machine import I2C, Pin, UART

link = UART(1, 115200)
panel = I2C(0, scl=Pin(9), sda=Pin(8))


def telemetry(samples):
    for n in range(samples):
        link.write("%d\n" % n)
        panel.write(b"\x40tick")
        time.sleep_ms(10)


def banner(display):
    while True:
        display.write("READY")
        time.sleep_ms(500)
