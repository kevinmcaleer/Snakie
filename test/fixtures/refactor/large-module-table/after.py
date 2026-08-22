"""Gait tables for a twelve-servo quadruped.

Both tables below are built at import time and never freed. Whether the answer
is a `bytes` literal, a file read on demand or computing the values depends on
how they are read, so the rule explains and leaves the code alone: this file is
its own `after.py`.
"""
from machine import PWM, Pin

LEG_ORDER = ("fl", "fr", "rl", "rr")
STEP_MS = 20

SINE_Q8 = [
    128, 139, 150, 160, 171, 181, 191, 200, 209, 217, 225, 232,
    237, 243, 247, 250, 253, 254, 255, 254, 253, 250, 247, 243,
    237, 232, 225, 217, 209, 200, 191, 181, 171, 160, 150, 139,
    128, 116, 105, 95, 84, 74, 64, 55, 46, 38, 30, 23,
    18, 12, 8, 5, 2, 1, 1, 1, 2, 5, 8, 12,
    18, 23, 30, 38, 46, 55, 64, 74, 84, 95, 105, 116,
]

SERVO_TRIM = {
    "front_left_hip": (1470, 520, 2400),
    "front_left_knee": (1471, 523, 2395),
    "front_right_hip": (1472, 526, 2390),
    "front_right_knee": (1473, 529, 2385),
    "rear_left_hip": (1474, 532, 2380),
    "rear_left_knee": (1475, 535, 2375),
    "rear_right_hip": (1476, 538, 2370),
    "rear_right_knee": (1477, 541, 2365),
    "neck_pan": (1478, 544, 2360),
    "neck_tilt": (1479, 547, 2355),
    "tail_yaw": (1480, 550, 2350),
    "jaw": (1481, 553, 2345),
}


def hip_angle(phase):
    """Sine-driven hip angle, phase in 0..71."""
    return SINE_Q8[phase % len(SINE_Q8)]


def trim_for(joint):
    return SERVO_TRIM[joint][0]
