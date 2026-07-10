# Buddy Jr — pose player + a beep
# =============================================================================
# A quick demo that plays your saved poses and lets you play with the on-board
# instruments. Everything hardware comes from Snakie's `snakie` module, so the
# code reads pin -> PWM -> Servo, and there's no clash with a vendor `servo`
# module (Pimoroni's frozen one, etc.).
#
# Because each Servo is made with `pin=`, it reports its angle to Snakie — so as
# this runs you'll see the 3-D model move AND the Pose bench / Oscilloscope
# instruments follow along live. The buzzer lights up the Buzzer panel.
#
# Run it, then open the instrument dock and watch.

from snakie import Servo, Buzzer, Pin, PWM
import time

# --- Servos: signal wires on GP0..GP3 ---------------------------------------
# Make each PWM yourself, then hand it to a Servo. `pin=n` tells Snakie which
# GPIO it is, so the 3-D model + Pose bench mirror every move.
servos = {
    "base":     Servo(PWM(Pin(0)), pin=0),
    "shoulder": Servo(PWM(Pin(1)), pin=1),
    "arm":      Servo(PWM(Pin(2)), pin=2),
    "camera":   Servo(PWM(Pin(3)), pin=3),
}

# --- Poses: servo angles (0..180) -------------------------------------------
# Your Snakie poses, expressed as servo angles (centre = 90). Tweak to taste —
# these are what actually gets sent to the servos.
POSES = {
    "start":        {"base": 90, "shoulder": 90,  "arm": 90, "camera": 90},
    "duck":         {"base": 0,  "shoulder": 153, "arm": 32, "camera": 5},
    "look_forward": {"base": 92, "shoulder": 121, "arm": 81, "camera": 24},
    "look_down":    {"base": 75, "shoulder": 94,  "arm": 64, "camera": 152},
}


def glide(pose, ms=700, steps=35):
    """Smoothly ease every servo to `pose` (a {name: angle} dict)."""
    start = {name: s.angle_deg for name, s in servos.items()}
    for k in range(steps + 1):
        t = k / steps
        e = t * t * (3 - 2 * t)  # smoothstep (ease in/out)
        for name, s in servos.items():
            target = pose.get(name, start[name])
            s.angle(start[name] + (target - start[name]) * e)
        time.sleep_ms(ms // steps)


# --- A buzzer to play with (optional: piezo on GP5) --------------------------
beeper = Buzzer(PWM(Pin(5)))


def chirp(freq=880):
    try:
        beeper.tone(freq, 90)  # 90 ms blip
    except Exception:
        pass  # no buzzer wired? no problem


# --- Run: tour the poses, chirp as each one lands ----------------------------
tour = ["start", "duck", "look_forward", "look_down"]
print("Buddy Jr pose demo — open the instrument dock and watch it follow along.")
while True:
    for name in tour:
        print("pose:", name)
        chirp()
        glide(POSES[name])
        time.sleep(1)

# --- Tip -----------------------------------------------------------------------
# The Pose bench instrument's sliders and pose buttons already drive the 3-D model
# live on their own — you don't need a program running for that. This demo is the
# other direction: your *code* driving the servos (and the model + panels follow).
# Change the POSES angles, the tour order, or the glide time and re-run.
