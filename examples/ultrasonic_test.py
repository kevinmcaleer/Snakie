"""Grove Ultrasonic Ranger TEST — is it wired right, and is it any good?

Diagnostic, not a demo. `grove_ultrasonic_demo.py` shows a clean, smoothed
distance on the Range instrument; this shows the RAW readings and how many pings
came back at all, which is what tells you whether the sensor is working.

It runs in two phases:

  1. **Wiring check** — a burst of pings. If none echo, it says what that usually
     means and stops, rather than scrolling failures forever.
  2. **Quality check** — raw distances with a running echo rate, min/max spread
     and the worst jump between consecutive readings. Point it at a wall about
     30 cm away: a healthy sensor holds within a few mm.

Set SIG_PIN first — this is the single commonest reason it reads nothing.

There is deliberately no "scan the pins to find it" mode. Finding the sensor
would mean pulsing candidate GPIOs as outputs, and on a XIAO ESP32-S3 the numbers
either side of the broken-out range (GPIO26-32) are wired to the SPI flash and
PSRAM — driving those is not something a test app should do on a guess. The
mapping table above is the safe way to get the pin right.
"""

import time
from grove_ultrasonic import GroveUltrasonic

# The Grove digital port's SIG line. The port is D0 on every XIAO; the GPIO
# behind that name is NOT the same on every XIAO:
#
#     XIAO ESP32-S3          D0 = GPIO1     <- the default here
#     XIAO RP2040 / RP2350   D0 = GP26
SIG_PIN = 1

#: The sensor needs ~60 ms between pings or it measures the PREVIOUS ping's echo.
PING_MS = 60

#: Pings in the wiring check, and how many must echo for it to count as wired.
CHECK_PINGS = 10
CHECK_MIN_ECHOES = 1

#: How many readings each quality summary covers.
BATCH = 20


def ping():
    """One raw reading in mm, or None when no echo came back."""
    mm = sensor.distance_mm()
    return None if mm < 0 else mm


sensor = GroveUltrasonic(SIG_PIN)

print("=" * 52)
print("Grove Ultrasonic Ranger test — SIG on pin %d" % SIG_PIN)
print("=" * 52)

# --- Phase 1: is anything there? --------------------------------------------
print("\n[1] Wiring check — %d pings ..." % CHECK_PINGS)
echoes = []
for _ in range(CHECK_PINGS):
    mm = ping()
    print("    %s" % ("no echo" if mm is None else "%.1f mm" % mm))
    if mm is not None:
        echoes.append(mm)
    time.sleep_ms(PING_MS)

if len(echoes) < CHECK_MIN_ECHOES:
    print("\n    NOTHING came back. In rough order of likelihood:")
    print("      - Wrong pin. SIG_PIN is %d; D0 is GPIO1 on a XIAO ESP32-S3" % SIG_PIN)
    print("        and GP26 on a XIAO RP2040/RP2350.")
    print("      - Plugged into the wrong Grove port (this needs a DIGITAL one,")
    print("        not I2C or UART).")
    print("      - No power: the ranger wants 3.2-5.2 V on VCC.")
    print("      - It is an HC-SR04, not a Grove ranger. That part has separate")
    print("        TRIG and ECHO pins and needs the hcsr04 driver instead.")
    print("      - Nothing within ~5 m in front of it (it times out at 30 ms).")
    raise SystemExit

print("\n    OK — %d of %d pings echoed." % (len(echoes), CHECK_PINGS))

# --- Phase 2: how good are the readings? ------------------------------------
print("\n[2] Quality check — raw readings, Ctrl-C to stop.")
print("    Aim it at a flat wall ~30 cm away; a good sensor holds within a few mm.\n")

seen = []
misses = 0
last = None
worst_jump = 0.0

try:
    while True:
        mm = ping()
        if mm is None:
            misses += 1
            print("    no echo")
        else:
            if last is not None:
                jump = abs(mm - last)
                if jump > worst_jump:
                    worst_jump = jump
            last = mm
            seen.append(mm)
            print("    %7.1f mm" % mm)

        if len(seen) + misses >= BATCH:
            total = len(seen) + misses
            if seen:
                lo, hi = min(seen), max(seen)
                mean = sum(seen) / len(seen)
                print(
                    "    -- %d/%d echoed | %.1f-%.1f mm (spread %.1f) | mean %.1f"
                    " | worst jump %.1f" % (len(seen), total, lo, hi, hi - lo, mean, worst_jump)
                )
            else:
                print("    -- 0/%d echoed — it has stopped responding" % total)
            seen = []
            misses = 0
            last = None
            worst_jump = 0.0

        time.sleep_ms(PING_MS)
except KeyboardInterrupt:
    print("\nstopped")
