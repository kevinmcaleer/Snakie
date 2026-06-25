/**
 * The I²C-detect demo program the IDE opens + runs when SCAN is pressed and no
 * Snakie program is detected on the board. Kept in sync with the reference copy
 * at `examples/i2c_detect_demo.py`.
 *
 * Unlike Wi-Fi, the on-device `scan:i2c` trigger is only registered when a bus
 * is handed to `inst.start(i2c=…)` (see python/tests `test_start_with_i2c_…`), so
 * the demo creates an I²C bus, starts the service WITH it, and runs one scan up
 * front so the grid fills immediately. Pressing SCAN afterwards drives a fresh
 * scan on the board's second core without blocking this loop.
 */
export const I2C_DETECT_DEMO_NAME = 'i2c_detect_demo.py'

export const I2C_DETECT_DEMO = `"""I²C detect demo for Snakie.

Open & Run this, then press SCAN in the I²C instrument: each press scans the
bus and lights every responding address — without blocking this loop. Edit the
sda/scl pins below to match your wiring (these are RP2040 I2C0 defaults).
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
`
