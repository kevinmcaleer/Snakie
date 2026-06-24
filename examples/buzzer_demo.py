"""Buzzer / music-player demo for Snakie.

Open & Run this, then use the Buzzer instrument: clicking keys, the melody
sequencer's ▶ Play, and the RTTTL ringtone all drive a passive buzzer/speaker
wired to a PWM pin. ``inst.start(buzzer_pin=15)`` attaches the buzzer to GP15
and services the ``buzzer`` control channel on the SECOND CORE (core 1), so the
notes sound without blocking this loop.

Wire a passive piezo buzzer / small speaker between GP15 and GND (change the pin
below to match your board), then press a key in the panel.
"""
import time
import instruments as inst

inst.start(buzzer_pin=15)   # attach the buzzer to GP15 + service it on core 1

while True:
    # Your robot's main loop runs here on core 0; the buzzer plays on core 1
    # whenever the IDE's Buzzer panel sends a tone / sequence.
    time.sleep(1)
