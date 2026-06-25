"""Bluetooth scanner demo for Snakie.

Open & Run this, then press SCAN in the Bluetooth instrument: each press runs a
BLE scan on the SECOND CORE and lists nearby devices — without blocking this
loop. Needs a BLE-capable board (Pico W / ESP32).

Kept in sync with the in-app copy at
src/renderer/src/components/bt-scan-demo.ts.
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
