"""Buzzer / music-player demo for Snakie.

Open & Run this, then use the Buzzer instrument: clicking keys, the melody
sequencer's ▶ Play, and the RTTTL ringtone drive a passive buzzer/speaker on a
PWM pin. ``inst.start(buzzer_pin=..., background=False)`` attaches the buzzer and
registers the receiver WITHOUT a background thread; the loop's
``inst.control.poll()`` services the IDE's commands on the main core.

Wire a passive piezo buzzer / small speaker between the pin below and GND (this
matches the panel's PIN selector). Press Stop in Snakie to halt cleanly.
"""
import time
import instruments as inst

BUZZER_PIN = 15  # GPIO the buzzer is wired to — set from the panel's PIN selector

# background=False is important: never spawn the 2nd-core thread (it shares stdin
# with the REPL and can wedge the board). Service the channel on this loop.
inst.start(buzzer_pin=BUZZER_PIN, background=False)

_beat = time.ticks_ms()
try:
    while True:
        inst.control.poll()  # service the IDE's buzzer commands
        if time.ticks_diff(time.ticks_ms(), _beat) >= 1500:
            _beat = time.ticks_ms()
            inst.ready()  # tell the IDE we're live (works on any library version)
        time.sleep_ms(20)
except KeyboardInterrupt:
    inst.stop()  # Stop pressed (Ctrl-C) -> silence the buzzer
