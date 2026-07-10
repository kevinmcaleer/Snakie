"""Unit tests for the device-side ``micropython/snakie_motion.py`` runtime (#412).

They assert the joint↔servo calibration mirrors the app (``jointToServo`` /
``servoToJoint`` in ``src/shared/krf.ts``), that ``goto_pose`` is non-blocking with
the ``ease`` (smoothstep) curve, that sequences play and puppet controls blend, and
that ``snapshot`` / ``joint_state`` report the right units — all under CPython, no
``machine`` module. Run from the repo root::

    PYTHONPATH=python python3 -m unittest discover -s python/tests
"""

import importlib.util
import io
import math
import os
import sys
import unittest
from contextlib import redirect_stdout

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# So snakie_motion's lazy `import instruments` resolves to the real device lib.
sys.path.insert(0, os.path.join(_REPO_ROOT, "micropython"))

_LIB_PATH = os.path.join(_REPO_ROOT, "micropython", "snakie_motion.py")
_spec = importlib.util.spec_from_file_location("snakie_motion_under_test", _LIB_PATH)
assert _spec and _spec.loader
motion = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(motion)

DEG2RAD = math.pi / 180.0


class _FakeServo:
    """A stand-in for ``instruments.Servo`` that records every ``angle(deg)`` call."""

    def __init__(self):
        self.degs = []

    def angle(self, deg):
        self.degs.append(deg)
        return deg


def _servo(joint="j", **kw):
    fake = _FakeServo()
    s = motion.Servo(0, joint, _servo=fake, **kw)
    return s, fake


class CalibrationTests(unittest.TestCase):
    def test_write_joint_matches_jointToServo(self):
        # jointMin/max in degrees; servo 0..180; centre maps to 90.
        s, _ = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180)
        self.assertEqual(s.write_joint(0.0), 90)
        self.assertEqual(s.write_joint(90 * DEG2RAD), 180)
        self.assertEqual(s.write_joint(-90 * DEG2RAD), 0)
        # Out-of-range joint clamps at the servo endpoint.
        self.assertEqual(s.write_joint(180 * DEG2RAD), 180)

    def test_invert_flips_the_mapping(self):
        s, _ = _servo(joint_min=-90, joint_max=90, invert=True)
        self.assertEqual(s.write_joint(-90 * DEG2RAD), 180)
        self.assertEqual(s.write_joint(90 * DEG2RAD), 0)

    def test_servo_sub_range_and_trim(self):
        s, _ = _servo(joint_min=-90, joint_max=90, servo_min=30, servo_max=150)
        self.assertEqual(s.write_joint(0.0), 90)  # midpoint of 30..150
        self.assertEqual(s.write_joint(90 * DEG2RAD), 150)
        # Trim offsets the servo degree, clamped to the soft servo max.
        s2, _ = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180, trim=10)
        self.assertEqual(s2.write_joint(0.0), 100)  # 90 + 10
        self.assertEqual(s2.write_joint(90 * DEG2RAD), 180)  # 180 + 10 clamped to 180

    def test_deg_per_joint_rad_slope(self):
        s, _ = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180)
        # 180 servo-deg over 180 joint-deg = 1 deg/deg → RAD2DEG servo-deg per joint-rad.
        self.assertAlmostEqual(s.deg_per_joint_rad, 180.0 / math.pi, places=4)
        s2, _ = _servo(joint_min=-90, joint_max=90, invert=True)
        self.assertAlmostEqual(s2.deg_per_joint_rad, -180.0 / math.pi, places=4)

    def test_emits_snk_servo_line_headless(self):
        # Uses the REAL instruments.Servo (no `machine`): write_joint prints SNK SERVO.
        s = motion.Servo(5, "j", joint_min=-90, joint_max=90)
        buf = io.StringIO()
        with redirect_stdout(buf):
            s.write_joint(0.0)  # joint 0° → servo 90
        self.assertIn("SNK SERVO 5 90", buf.getvalue().splitlines())


class RigMoveTests(unittest.TestCase):
    def _rig(self):
        s, fake = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180)
        return motion.Rig({"j": s}), s, fake

    def test_goto_pose_is_non_blocking_and_eases(self):
        rig, s, fake = self._rig()
        # Servo starts at 90° → joint 0°.
        rig.goto_pose({"j": 90}, duration=1.0, easing="easeInOut")
        t0 = rig._move["t0"]
        self.assertTrue(rig.update(t0))  # u=0, still moving
        self.assertEqual(fake.degs[-1], 90)  # start = joint 0° → servo 90
        # Halfway in time → ease(0.5)=0.5 → joint 45° → servo 135.
        self.assertTrue(rig.update(t0 + 500))
        self.assertEqual(fake.degs[-1], 135)
        # End → joint 90° → servo 180, and no longer moving.
        self.assertFalse(rig.update(t0 + 1000))
        self.assertEqual(fake.degs[-1], 180)

    def test_partial_pose_holds_unlisted_joints(self):
        a, fa = _servo("a", joint_min=-90, joint_max=90)
        b, fb = _servo("b", joint_min=-90, joint_max=90)
        rig = motion.Rig({"a": a, "b": b})
        rig.goto_pose({"a": 90}, duration=1.0)  # b not in the pose
        t0 = rig._move["t0"]
        rig.update(t0 + 1000)
        self.assertEqual(fa.degs[-1], 180)  # a moved to 90°
        self.assertEqual(fb.degs[-1], 90)  # b held at 0° → servo 90


class RigSequenceTests(unittest.TestCase):
    def test_play_advances_through_steps(self):
        s, fake = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180)
        rig = motion.Rig({"j": s})
        rig.play([({"j": -90}, 100), ({"j": 90}, 100)])
        t0 = rig._move["t0"]
        # Step 1 completes → servo at -90° (0); advances to step 2 (still moving).
        self.assertTrue(rig.update(t0 + 100))
        self.assertEqual(fake.degs[-1], 0)
        t1 = rig._move["t0"]
        # Step 2 completes → servo at 90° (180); sequence done.
        self.assertFalse(rig.update(t1 + 100))
        self.assertEqual(fake.degs[-1], 180)

    def test_play_loops(self):
        s, fake = _servo(joint_min=-90, joint_max=90)
        rig = motion.Rig({"j": s})
        rig.play([({"j": -90}, 100), ({"j": 90}, 100)], loop=True)
        t0 = rig._move["t0"]
        self.assertTrue(rig.update(t0 + 100))  # step1 → step2
        t1 = rig._move["t0"]
        self.assertTrue(rig.update(t1 + 100))  # step2 done → WRAPS to step1 (loop)
        self.assertIsNotNone(rig._move)  # still running


class RigControlTests(unittest.TestCase):
    def test_set_control_blends_immediately(self):
        s, fake = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180)
        rig = motion.Rig({"j": s})
        rig.add_control("mouth", [{"j": -90}, {"j": 90}])
        rig.set_control("mouth", 0.0)  # low pose → joint -90° → servo 0
        self.assertEqual(fake.degs[-1], 0)
        rig.set_control("mouth", 1.0)  # high pose → joint 90° → servo 180
        self.assertEqual(fake.degs[-1], 180)
        rig.set_control("mouth", 0.5)  # midpoint → joint 0° → servo 90
        self.assertEqual(fake.degs[-1], 90)

    def test_three_pose_control_uses_the_right_segment(self):
        s, fake = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180)
        rig = motion.Rig({"j": s})
        rig.add_control("blend", [{"j": -90}, {"j": 0}, {"j": 90}])
        rig.set_control("blend", 0.25)  # first half → between -90 and 0 → -45° → servo 45
        self.assertEqual(fake.degs[-1], 45)
        rig.set_control("blend", 0.75)  # second half → between 0 and 90 → 45° → servo 135
        self.assertEqual(fake.degs[-1], 135)


class RigStateTests(unittest.TestCase):
    def test_snapshot_and_joint_state(self):
        s, _ = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180)
        rig = motion.Rig({"j": s})
        s.write_joint(45 * DEG2RAD)  # → servo 135 → joint 45°
        snap = rig.snapshot()
        self.assertAlmostEqual(snap["j"], 45.0, places=1)  # DISPLAY degrees
        state = rig.joint_state()
        self.assertAlmostEqual(state["j"], 45 * DEG2RAD, places=3)  # RADIANS

    def test_version_literal_present(self):
        self.assertTrue(hasattr(motion, "__version__"))
        self.assertIsInstance(motion.__version__, str)


class RoundingAndEasingTests(unittest.TestCase):
    def test_half_degree_rounds_half_up_like_math_round(self):
        # Identity map (joint deg == servo deg). A servo raw landing on x.5 must round
        # UP (JS Math.round, what jointToServo uses), not to-even (Python's round()).
        s, _ = _servo(joint_min=0, joint_max=180, servo_min=0, servo_max=180)
        self.assertEqual(s.write_joint(0.5 * DEG2RAD), 1)  # 0.5 → 1 (not 0)
        self.assertEqual(s.write_joint(2.5 * DEG2RAD), 3)  # 2.5 → 3 (not 2)

    def test_easing_is_smoothstep_not_linear(self):
        # At u=0.25 the smoothstep (ease_in_out) is well behind a linear ramp, so the
        # two produce DIFFERENT servo degrees — a linear-only impl would fail this.
        se, fe = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180)
        sl, fl = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180)
        re = motion.Rig({"j": se})
        rl = motion.Rig({"j": sl})
        re.goto_pose({"j": 90}, duration=1.0, easing="easeInOut")
        rl.goto_pose({"j": 90}, duration=1.0, easing="linear")
        t0 = re._move["t0"]
        re.update(t0 + 250)
        rl._move["t0"] = t0
        rl.update(t0 + 250)
        self.assertNotEqual(fe.degs[-1], fl.degs[-1])
        self.assertLess(fe.degs[-1], fl.degs[-1])  # smoothstep starts slower

    def test_reversed_servo_range_matches_the_app(self):
        # servo_min > servo_max (a flip via range, not the invert flag) still lerps
        # correctly (order-agnostic clamp), like jointToServo.
        s, _ = _servo(joint_min=-90, joint_max=90, servo_min=150, servo_max=30)
        self.assertEqual(s.write_joint(-90 * DEG2RAD), 150)
        self.assertEqual(s.write_joint(0.0), 90)
        self.assertEqual(s.write_joint(90 * DEG2RAD), 30)


class TrimTests(unittest.TestCase):
    def test_snapshot_round_trips_the_commanded_pose_with_trim(self):
        # trim shifts the SERVO degree but Capture Pose must report the COMMANDED joint
        # so a captured pose replays exactly (no trim drift).
        s, _ = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180, trim=8)
        rig = motion.Rig({"j": s})
        s.write_joint(30 * DEG2RAD)
        self.assertAlmostEqual(rig.snapshot()["j"], 30.0, places=6)

    def test_looping_fixed_pose_does_not_drift_with_trim(self):
        s, fake = _servo(joint_min=-90, joint_max=90, servo_min=0, servo_max=180, trim=8)
        rig = motion.Rig({"j": s})
        rig.play([({"j": 30}, 100)], loop=True)
        t = rig._move["t0"]
        seen = set()
        for _ in range(6):  # several loop cycles
            rig.update(t + 100)
            seen.add(fake.degs[-1])
            t = rig._move["t0"]
        # Every cycle lands on the SAME servo degree — the start is read from the
        # commanded value, so trim never accumulates.
        self.assertEqual(len(seen), 1)


if __name__ == "__main__":
    unittest.main()
