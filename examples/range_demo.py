"""Ultrasonic rangefinder (HC-SR04) demo for Snakie.

Open & Run this, then use the Range instrument: its RADAR / GAUGE shows the live
distance, and the TRIG / ECHO pin selectors retarget the sensor's wiring over the
control channel. ``inst.start(range_trig=..., range_echo=..., background=False)``
attaches the shared rangefinder and registers the ``range`` receiver WITHOUT a
background thread; the loop's ``inst.control.poll()`` services the IDE's commands
on the main core, ``inst.ranger.read()`` pings the sensor, and ``inst.distance(mm)``
feeds the radar.

Wire an HC-SR04: TRIG to the trig pin below, ECHO to the echo pin (through a
level divider — ECHO is 5 V), VCC to 5 V, GND to GND (this matches the panel's
TRIG / ECHO selectors). Press Stop in Snakie to halt cleanly.
"""
import time
import instruments as inst

RANGE_TRIG = 3  # GPIO the HC-SR04 TRIG is wired to (from the panel's TRIG selector)
RANGE_ECHO = 2  # GPIO the HC-SR04 ECHO is wired to (from the panel's ECHO selector)

# background=False is important: never spawn the 2nd-core thread (it shares stdin
# with the REPL and can wedge the board). Service the channel on this loop.
inst.start(range_trig=RANGE_TRIG, range_echo=RANGE_ECHO, background=False)

_beat = time.ticks_ms()
try:
    while True:
        inst.control.poll()  # service the IDE's range commands (retarget pins)
        mm = inst.ranger.read()  # fire one ping; mm distance, or None on timeout
        if mm is not None:
            inst.distance(mm)  # feed the Range instrument's radar / gauge
        if time.ticks_diff(time.ticks_ms(), _beat) >= 1500:
            _beat = time.ticks_ms()
            inst.ready()  # tell the IDE we're live (works on any library version)
        time.sleep_ms(60)
except KeyboardInterrupt:
    inst.stop()  # Stop pressed (Ctrl-C) -> halt cleanly
