"""Servo showcase — one signal, three instruments at once (servo on GP0).

Wire the servo: signal (orange) → GP0, power (red) → 5V, ground (brown) → GND.
Run this, then open three panels in the Instrument Dock and watch them share the
one signal:

  • Servo   — drag the dial or press SWEEP to command an angle
  • Scope   — the 50 Hz PWM square wave; its duty widens/narrows with the angle
  • Plotter — the commanded angle, graphed over time

Nothing here drives the servo directly. The Servo PANEL sends the commands; this
program just SERVICES them and REPORTS what's happening on the serial stream. So
control (one writer) and the scope + plotter (many readers) never fight over the
pin — they meet on the telemetry stream instead.
"""

import instruments as inst
import time

# Attach the shared servo singleton to GP0 and start the control service, so the
# IDE's Servo panel can drive it (angle / sweep / pin / detach).
inst.start(servo_pin=0)
inst.servo.angle(90)  # centre it — and print the first PWM reading for the Scope

while True:
    # Service the Servo panel. Each commanded move runs servo.angle(), which
    # prints `SNK PWM servo <freq> <duty>` → the Scope draws the live PWM.
    inst.control.poll()
    # Graph the servo's current angle → the Plotter traces it over time.
    inst.plot(angle=inst.servo.angle_deg)
    time.sleep(0.05)
