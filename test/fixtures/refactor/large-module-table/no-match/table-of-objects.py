"""A long module-level list that is not a table of data.

Every entry is a constructed object, and the objects have to exist: none of the
ways out — a `bytes` literal, a file read on demand, computing the values — can
be applied to them. The rule stays quiet however long the list runs.
"""
from machine import PWM, Pin


class Servo:
    def __init__(self, name, pin, joint, min_deg, max_deg, invert=False):
        self.name = name
        self.pwm = PWM(Pin(pin))
        self.joint = joint
        self.limits = (min_deg, max_deg)
        self.invert = invert


servos = [
    Servo("hip_l", pin=0, joint="hip_left", min_deg=-60, max_deg=60),
    Servo("hip_r", pin=1, joint="hip_right", min_deg=-60, max_deg=60, invert=True),
    Servo("knee_l", pin=2, joint="knee_left", min_deg=0, max_deg=90),
    Servo("knee_r", pin=3, joint="knee_right", min_deg=0, max_deg=90, invert=True),
    Servo("jaw", pin=4, joint="jaw_joint", min_deg=-20, max_deg=25),
    Servo("cheek_l", pin=5, joint="cheek_left", min_deg=-40, max_deg=40),
    Servo("cheek_r", pin=6, joint="cheek_right", min_deg=-40, max_deg=40),
]

BY_JOINT = {servo.joint: servo for servo in servos}
