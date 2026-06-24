/**
 * The buzzer demo program the IDE opens + runs when a buzzer action is taken and
 * no Snakie program is detected on the board (mirrors `wifi-scan-demo.ts`). Kept
 * in sync with the reference copy at `examples/buzzer_demo.py`.
 *
 * It starts the `snakie` background service with `buzzer_pin=15` — attaching the
 * shared buzzer to `PWM(Pin(15))` and registering the `buzzer` control receiver —
 * then idles, so the panel's keys / melody / ringtone drive the speaker over the
 * control channel (playback runs on the board's second core, off the main loop).
 */
export const BUZZER_DEMO_NAME = 'buzzer_demo.py'

export const BUZZER_DEMO = `"""Buzzer / music-player demo for Snakie.

Open & Run this, then use the Buzzer instrument: clicking keys, the melody
sequencer's PLAY, and the RTTTL ringtone all drive a passive buzzer/speaker on a
PWM pin. inst.start(buzzer_pin=...) attaches the buzzer and services the buzzer
control channel on the SECOND CORE (core 1), so notes sound without blocking
this loop.

Wire a passive piezo buzzer / small speaker between the pin below and GND, set
BUZZER_PIN to match (or use the panel's PIN selector to retarget it live), then
press a key in the panel. Press Stop in Snakie to halt cleanly.
"""
import time
import instruments as inst

BUZZER_PIN = 15  # GPIO the buzzer is wired to — change to match your board

inst.start(buzzer_pin=BUZZER_PIN)  # attach the buzzer + service it on core 1

try:
    while True:
        # Your robot's main loop runs here on core 0; the buzzer plays on core 1.
        time.sleep(1)
except KeyboardInterrupt:
    inst.stop()  # Stop pressed (Ctrl-C) -> end the 2nd-core service thread
`
