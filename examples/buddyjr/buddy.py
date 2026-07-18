"""Example of the file Snakie would generate / round-trip."""

from snakie_motion import Rig, Servo

# --- snakie:poses (managed by Snakie — edits here are read back into the UI) ---
POSES = {
    "neutral": {"hip_l": 0,   "hip_r": 0,   "knee_l": 20, "knee_r": 20},
    "step_l":  {"hip_l": 25,  "hip_r": -15, "knee_l": 45, "knee_r": 10},
    "step_r":  {"hip_l": -15, "hip_r": 25,  "knee_l": 10, "knee_r": 45},
    "smile":   {"jaw": 12, "cheek_l": 30, "cheek_r": 30},
    "frown":   {"jaw": -5, "cheek_l": -20, "cheek_r": -20},
}

SEQUENCES = {
    "walk": [
        ("step_l",  400, "ease_in_out"),
        ("neutral", 200, "ease_in_out"),
        ("step_r",  400, "ease_in_out"),
        ("neutral", 200, "ease_in_out"),
    ],
}

CONTROLS = {
    "mouth": {"type": "slider", "blend": ["frown", "neutral", "smile"]},
}
# --- /snakie:poses ---

# --- snakie:servos (managed by Snakie breadboard view) ---
servos = [
    Servo("hip_l",   pin=0, joint="hip_left",   min_deg=-60, max_deg=60),
    Servo("hip_r",   pin=1, joint="hip_right",  min_deg=-60, max_deg=60, invert=True),
    Servo("knee_l",  pin=2, joint="knee_left",  min_deg=0,   max_deg=90),
    Servo("knee_r",  pin=3, joint="knee_right", min_deg=0,   max_deg=90, invert=True),
    Servo("jaw",     pin=4, joint="jaw_joint",  min_deg=-20, max_deg=25),
    Servo("cheek_l", pin=5, joint="cheek_left", min_deg=-40, max_deg=40),
    Servo("cheek_r", pin=6, joint="cheek_right",min_deg=-40, max_deg=40, invert=True),
]
# --- /snakie:servos ---

rig = Rig(servos, POSES, SEQUENCES, CONTROLS)

# User code below — Snakie never touches this.
rig.set_pose("neutral")
rig.play("walk", loop=True)

while True:
    rig.update()
    # ...read sensors, drive the mouth slider from a pot, etc.
    # rig.set_control("mouth", pot.read_u16() / 65535)
    import time
    time.sleep(0.02)
