"""Buzzer / music-player demo for Snakie.

Open & Run this, then use the Buzzer instrument: clicking keys, the melody
sequencer's ▶ Play, and the RTTTL ringtone all drive a passive buzzer/speaker
wired to a PWM pin. ``inst.start(buzzer_pin=...)`` attaches the buzzer and
registers the ``buzzer`` control receiver; the loop's ``inst.control.poll()``
services the commands the IDE sends.

Wire a passive piezo buzzer / small speaker between the pin below and GND, set
``BUZZER_PIN`` to match (or use the panel's PIN selector to retarget it live),
then press a key in the panel. Press Stop in Snakie to halt cleanly.
"""
import time
import instruments as inst

BUZZER_PIN = 15  # GPIO the buzzer is wired to — change to match your board

inst.start(buzzer_pin=BUZZER_PIN)  # attach the buzzer + register the receiver

try:
    while True:
        inst.control.poll()  # service the IDE's buzzer commands + heartbeat
        time.sleep(0.02)
except KeyboardInterrupt:
    inst.stop()  # Stop pressed (Ctrl-C) -> silence the buzzer
