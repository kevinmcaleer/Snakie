"""Wi-Fi scanner demo for Snakie.

Open & Run this, then press SCAN in the Wi-Fi instrument: each press runs a
network scan on the SECOND CORE and lists the access points — without blocking
this loop. Needs a Wi-Fi-capable board (Pico W / ESP32).
"""
import time
import instruments as inst

inst.start()        # control channel + scan triggers on the 2nd core (core 1)
inst.wifi_scan()    # one scan now so the panel fills immediately

try:
    while True:
        # Your robot's main loop runs here on core 0; Wi-Fi scans run on core 1.
        time.sleep(1)
except KeyboardInterrupt:
    inst.stop()     # Stop pressed (Ctrl-C) -> end the 2nd-core service thread
