# Live sliders — drive the REAL servos from the Pose bench instrument
# =============================================================================
# Run this, then in the Pose bench instrument drag a slider or press a pose
# button: the physical servos follow along (and the 3-D model too).
#
# HOW IT WORKS
#   The Pose bench sends every slider / pose change over Snakie's control channel
#   (e.g. `SNKCMD servos 0:90 1:45 2:120 3:30`). `inst.start()` sets up the
#   receiver; `inst.control.poll()` in the loop applies each change to the servos.
#   The control channel is non-invasive, so this keeps running while you play.
#
#   The 3-D model in the Robot view is driven DIRECTLY by the instrument, so it
#   already moves whether or not this program is running — this program is only
#   needed to move the real hardware.

import instruments as inst
from snakie import Servo, Pin, PWM
import time

# Make your servos ONCE (signal wires on GP0..GP3), so we reuse one PWM per pin.
servos = {
    0: Servo(PWM(Pin(0)), pin=0),
    1: Servo(PWM(Pin(1)), pin=1),
    2: Servo(PWM(Pin(2)), pin=2),
    3: Servo(PWM(Pin(3)), pin=3),
}

inst.start()  # opens the control channel + tells Snakie a program is running

# Point the `servos` command at OUR servos (reuse them, don't re-create a PWM on
# every move). Any pin we didn't pre-make falls back to a fresh one.
inst.control.on(
    "servos",
    lambda p: inst.servos_command(p, factory=lambda pin: servos.get(pin) or inst.servo_on(pin)),
)

print("Listening — drag the Pose bench sliders or press a pose button.")
while True:
    inst.control.poll()  # apply any slider / pose change from the instrument
    time.sleep_ms(20)
