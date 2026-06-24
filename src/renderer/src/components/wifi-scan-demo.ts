/**
 * The Wi-Fi scan demo program the IDE opens + runs when SCAN is pressed and no
 * Snakie program is detected on the board. Kept in sync with the reference copy
 * at `examples/wifi_scan_demo.py`.
 *
 * It starts the `snakie` background service (which polls the control channel and
 * services scan triggers on the board's second core) and runs one scan up front,
 * so pressing SCAN afterwards drives a fresh scan without blocking the loop.
 */
export const WIFI_SCAN_DEMO_NAME = 'wifi_scan_demo.py'

export const WIFI_SCAN_DEMO = `"""Wi-Fi scanner demo for Snakie.

Open & Run this, then press SCAN in the Wi-Fi instrument: each press runs a
network scan on the SECOND CORE and lists the access points — without blocking
this loop. Needs a Wi-Fi-capable board (Pico W / ESP32).
"""
import time
import instruments as inst

inst.start(background=False)  # register scan triggers; no 2nd-core thread
inst.wifi_scan()             # one scan now so the panel fills immediately

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
