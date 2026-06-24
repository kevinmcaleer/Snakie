"""Wi-Fi scanner demo for Snakie.

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
