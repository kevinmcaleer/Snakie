"""Buzzer / music-player demo for Snakie.

Open & Run this, then use the Buzzer instrument: clicking keys, the melody
sequencer's ▶ Play, and the RTTTL ringtone all drive a passive buzzer/speaker
wired to a PWM pin. ``inst.start(buzzer_pin=...)`` attaches the buzzer and
services the ``buzzer`` control channel on the SECOND CORE (core 1), so the
notes sound without blocking this loop.

Wire a passive piezo buzzer / small speaker between the pin below and GND, set
``BUZZER_PIN`` to match (or use the panel's PIN selector to retarget it live),
then press a key in the panel. Press Stop in Snakie to halt — it ends the
core-1 service cleanly so the REPL stays usable.
"""
import time
import instruments as inst

BUZZER_PIN = 15  # GPIO the buzzer is wired to — change to match your board

inst.start(buzzer_pin=BUZZER_PIN)  # attach the buzzer + service it on core 1

try:
    while True:
        # Your robot's main loop runs here on core 0; the buzzer plays on core 1
        # whenever the IDE's Buzzer panel sends a tone / sequence.
        time.sleep(1)
except KeyboardInterrupt:
    inst.stop()  # Stop pressed (Ctrl-C) → end the 2nd-core service thread
