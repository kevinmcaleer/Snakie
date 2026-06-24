"""Wi-Fi scanner demo for Snakie.

Open & Run this, then press SCAN in the Wi-Fi instrument: each press runs a
network scan and lists the access points. Needs a Wi-Fi-capable board (Pico W /
ESP32). The control channel is serviced on THIS loop (no second-core thread).
"""
import time
import instruments as inst

inst.start(background=False)  # register scan triggers; no 2nd-core thread
inst.wifi_scan()              # one scan now so the panel fills immediately

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
