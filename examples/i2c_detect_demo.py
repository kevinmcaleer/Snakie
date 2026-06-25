"""I2C detect demo for Snakie.

Open & Run this, then press SCAN in the I2C instrument: each press scans the
bus and lights every responding address — without blocking this loop. Edit the
sda/scl pins below to match your wiring (these are RP2040 I2C0 defaults).

Kept in sync with the in-app copy at
src/renderer/src/components/i2c-detect-demo.ts.
"""
import time
from machine import I2C, Pin
import instruments as inst

i2c = I2C(0, sda=Pin(4), scl=Pin(5))   # your I2C bus (SDA=GP4, SCL=GP5)

inst.start(background=False, i2c=i2c)   # registers the scan:i2c trigger for this bus
inst.i2c_scan(i2c)                      # one scan now so the grid fills immediately

_beat = time.ticks_ms()
try:
    while True:
        inst.control.poll()  # service SCAN commands from the IDE
        if time.ticks_diff(time.ticks_ms(), _beat) >= 1500:
            _beat = time.ticks_ms()
            inst.ready()  # tell the IDE we're live (works on any library version)
        time.sleep_ms(20)
except KeyboardInterrupt:
    inst.stop()  # Stop pressed (Ctrl-C) -> silence + clear
