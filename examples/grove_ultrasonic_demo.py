"""Grove Ultrasonic Ranger demo for Snakie.

Open & Run this, then open the **Range** instrument in the dock: it shows a live
distance gauge fed by the ``SNK DIST`` lines below. The readings also print to the
console, so the demo is useful with nothing but the REPL.

Wiring
------
The Grove Ultrasonic Ranger has **one `SIG` wire that is both trigger and echo**
— it is NOT an HC-SR04, and a two-pin (TRIG/ECHO) driver cannot drive it.

Plug it into a Grove **digital** port. On a XIAO Expansion Base that is the
analog/digital port on `D0`/`D1`, and `SIG` lands on `D0`. The GPIO behind `D0`
depends on which XIAO is seated:

    XIAO ESP32-S3          D0 = GPIO1     <- SIG_PIN below
    XIAO RP2040 / RP2350   D0 = GP26

Note the expansion base wires its user BUTTON to `D1`, the second pin of that same
Grove port — harmless here, since this sensor only uses `SIG`.
"""

import time
import instruments as inst
from grove_ultrasonic import GroveUltrasonic

SIG_PIN = 1  # D0 on a XIAO ESP32-S3. Change to 26 for a XIAO RP2040/RP2350.

#: Minimum gap between pings, in ms. The previous burst is still bouncing around
#: the room for a while after it is sent, so pinging faster than this measures the
#: LAST ping's echo and reports nonsense. ~60 ms is the sensor's own cycle time.
PING_MS = 60

#: How many readings to take the median of. Ultrasonics spike — a single bad
#: reflection off an edge reads as a wild value — and the median throws those away
#: without the lag an average would add.
WINDOW = 3

sensor = GroveUltrasonic(SIG_PIN)
recent = []

print("Grove Ultrasonic Ranger on pin %d — Ctrl-C to stop" % SIG_PIN)

try:
    while True:
        mm = sensor.distance_mm()

        # -1 is "no echo came back", not a distance. Report it, but do NOT send it
        # to the instrument: the gauge takes any number at face value, so a -1
        # would draw as a real reading 1 mm behind the sensor.
        if mm < 0:
            print("no echo — out of range, or the target is soft (cloth, foam, a cat)")
            recent = []
            time.sleep_ms(PING_MS)
            continue

        recent.append(mm)
        if len(recent) > WINDOW:
            recent.pop(0)
        smoothed = sorted(recent)[len(recent) // 2]

        inst.distance(smoothed)  # -> SNK DIST -> the Range instrument
        print("%6.1f mm  (%5.1f cm)" % (smoothed, smoothed / 10))

        time.sleep_ms(PING_MS)
except KeyboardInterrupt:
    print("stopped")
