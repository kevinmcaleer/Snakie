"""One of the two fixes this hint points at: stream the rows out as they arrive.

The main loop holds a single row in RAM and writes it straight to flash, and the
one list in the file is a fixed header built before the loop starts. The heap
never grows, however long the run lasts.
"""
import time
from machine import ADC, Pin

battery = ADC(29)
led = Pin(25, Pin.OUT)

header = ["ticks", "battery"]

with open("log.csv", "w") as handle:
    handle.write(",".join(header))
    handle.write("\n")

while True:
    row = (time.ticks_ms(), battery.read_u16())
    with open("log.csv", "a") as handle:
        handle.write("{},{}\n".format(row[0], row[1]))
    led.toggle()
    time.sleep_ms(500)
