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

inst.start()        # register the scan triggers + the control receiver
inst.wifi_scan()    # one scan now so the panel fills immediately

try:
    while True:
        inst.control.poll()  # service SCAN commands from the IDE + heartbeat
        time.sleep(0.02)
except KeyboardInterrupt:
    inst.stop()     # Stop pressed (Ctrl-C) -> silence + clear
`
