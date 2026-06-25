/**
 * The Bluetooth scan demo program the IDE opens + runs when SCAN is pressed and
 * no Snakie program is detected on the board. Kept in sync with the reference
 * copy at `examples/bt_scan_demo.py`.
 *
 * `inst.start()` registers the `scan:bt` trigger by default (no bus needed,
 * unlike I²C), so this just starts the service and runs one scan up front so the
 * list fills immediately; pressing SCAN afterwards drives a fresh scan on the
 * board's second core without blocking this loop.
 */
export const BT_SCAN_DEMO_NAME = 'bt_scan_demo.py'

export const BT_SCAN_DEMO = `"""Bluetooth scanner demo for Snakie.

Open & Run this, then press SCAN in the Bluetooth instrument: each press runs a
BLE scan on the SECOND CORE and lists nearby devices — without blocking this
loop. Needs a BLE-capable board (Pico W / ESP32).
"""
import time
import instruments as inst

inst.start(background=False)  # register scan triggers (incl. scan:bt)
inst.bt_scan()               # one scan now so the panel fills immediately

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
