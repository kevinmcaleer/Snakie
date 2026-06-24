/**
 * The buzzer demo program the IDE opens + runs when a buzzer action is taken and
 * no Snakie program is detected on the board (mirrors `wifi-scan-demo.ts`). Kept
 * in sync with the reference copy at `examples/buzzer_demo.py`.
 *
 * It attaches the shared buzzer to `PWM(Pin(pin))`, registers the `buzzer`
 * control receiver, then services commands on the MAIN loop via
 * `inst.control.poll()` (which also emits the `SNK READY` heartbeat). The pin is
 * injected from the panel's PIN selector so "Run buzzer demo" matches the user's
 * wiring without an edit.
 */
export const BUZZER_DEMO_NAME = 'buzzer_demo.py'

/** Build the buzzer demo source with the buzzer wired to GP`pin`. */
export function buzzerDemo(pin: number): string {
  const p = Number.isFinite(pin) ? Math.round(pin) : 15
  return `"""Buzzer / music-player demo for Snakie.

Open & Run this, then use the Buzzer instrument: clicking keys, the melody
sequencer's PLAY, and the RTTTL ringtone drive a passive buzzer/speaker on a PWM
pin. inst.start(buzzer_pin=..., background=False) attaches the buzzer and
registers the receiver WITHOUT a background thread; the loop's
inst.control.poll() services the IDE's commands on the main core.

Wire a passive piezo buzzer / small speaker between the pin below and GND (this
matches the panel's PIN selector). Press Stop in Snakie to halt cleanly.
"""
import time
import instruments as inst

BUZZER_PIN = ${p}  # GPIO the buzzer is wired to (from the panel's PIN selector)

# background=False: never spawn the 2nd-core thread (it shares stdin with the
# REPL and can wedge the board). Service the channel on this loop instead.
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
`
}
