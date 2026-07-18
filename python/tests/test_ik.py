"""Unit tests for the device-side ``micropython/snakie_ik.py`` runtime (#539).

Three groups:

1. **Cross-language vectors** — loads the SAME language-neutral fixture the
   TypeScript suite runs (``test/fixtures/ik-vectors.json``, #538) and asserts
   the Python solver matches every case within the documented tolerance. This is
   the guarantee that browser and board agree.
2. **skeleton.json parsing** — loads a fixture skeleton (#537 schema) and checks
   bones, limits (deg -> rad) and servo bindings parse correctly, and that a
   named chain turns into the right bone lengths / limits.
3. **apply() drives servos** — a fake rig records every ``write_joint`` call, and
   a graceful-degrade case with no rig.

All under CPython, no ``machine`` module. Run from the repo root::

    PYTHONPATH=python python3 -m unittest discover -s python/tests
"""

import importlib.util
import json
import math
import os
import sys
import unittest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# So snakie_ik's lazy `import snakie_motion` / `import instruments` resolve to
# the real device libs (they guard `machine`, so this stays headless).
sys.path.insert(0, os.path.join(_REPO_ROOT, "micropython"))

_LIB_PATH = os.path.join(_REPO_ROOT, "micropython", "snakie_ik.py")
_spec = importlib.util.spec_from_file_location("snakie_ik_under_test", _LIB_PATH)
assert _spec and _spec.loader
ik = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ik)

_VECTORS_PATH = os.path.join(_REPO_ROOT, "test", "fixtures", "ik-vectors.json")
_FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
_ARM_SKELETON = os.path.join(_FIXTURE_DIR, "arm_skeleton.json")

LIMIT_SLACK = 1e-9


class VectorTests(unittest.TestCase):
    """Run the shared cross-language vectors through the Python solver, mirroring
    the runner semantics documented in ``src/shared/ik/README.md`` and
    implemented in ``test/ikSolver.test.ts``."""

    @classmethod
    def setUpClass(cls):
        with open(_VECTORS_PATH) as fh:
            cls.fixture = json.load(fh)

    def _solve(self, inp):
        return ik.solve_ik(
            inp["boneLengths"],
            inp["target"],
            limits=inp.get("limits"),
            current_angles=inp.get("currentAngles"),
            tolerance=inp.get("tolerance", ik.DEFAULT_TOLERANCE),
            max_iterations=inp.get("maxIterations", ik.DEFAULT_MAX_ITERATIONS),
        )

    def test_format_header(self):
        self.assertEqual(self.fixture["format"], "snakie-ik-vectors")
        self.assertEqual(self.fixture["version"], 1)
        self.assertGreaterEqual(len(self.fixture["cases"]), 30)
        ids = [c["id"] for c in self.fixture["cases"]]
        self.assertEqual(len(set(ids)), len(ids))

    def test_every_vector(self):
        cases = self.fixture["cases"]
        passed = 0
        for case in cases:
            with self.subTest(case=case["id"]):
                self._run_case(case)
            passed += 1
        # Sanity: we actually walked all 35 documented cases.
        self.assertEqual(passed, len(cases))

    def _run_case(self, case):
        inp = case["input"]
        exp = case["expected"]

        # 1. throws-expectation: assert the exact stable error code.
        if exp.get("throws"):
            with self.assertRaises(ValueError) as ctx:
                self._solve(inp)
            self.assertEqual(str(ctx.exception), exp["throws"])
            return

        result = self._solve(inp)

        # 2. status.
        self.assertEqual(result["status"], exp["status"], case["id"])

        # 3. every returned angle inside [-PI, PI) and inside its joint limit.
        limits = inp.get("limits")
        for i, a in enumerate(result["angles"]):
            self.assertGreaterEqual(a, -math.pi - LIMIT_SLACK, case["id"])
            self.assertLess(a, math.pi + LIMIT_SLACK, case["id"])
            lim = limits[i] if limits and i < len(limits) else None
            if lim is not None:
                self.assertGreaterEqual(a, lim[0] - LIMIT_SLACK, case["id"])
                self.assertLessEqual(a, lim[1] + LIMIT_SLACK, case["id"])

        # 4. reached: recompute FK from the returned angles (don't trust position).
        if exp["status"] == "reached":
            x, y = ik.forward_kinematics(inp["boneLengths"], result["angles"])
            tol = inp.get("tolerance", ik.DEFAULT_TOLERANCE)
            self.assertLessEqual(
                math.hypot(x - inp["target"][0], y - inp["target"][1]), tol, case["id"]
            )

        # 5. optional exact-angle assertion (wrapped difference).
        if exp.get("angles") is not None:
            self.assertEqual(len(result["angles"]), len(exp["angles"]), case["id"])
            atol = exp["angleTolerance"]
            for i, a in enumerate(exp["angles"]):
                self.assertLessEqual(
                    abs(ik.wrap_to_pi(result["angles"][i] - a)), atol, case["id"]
                )

        # 6. optional effector-position assertion.
        if exp.get("position") is not None:
            dist = math.hypot(
                result["position"][0] - exp["position"][0],
                result["position"][1] - exp["position"][1],
            )
            self.assertLessEqual(dist, exp["positionTolerance"], case["id"])


class SolverHelperTests(unittest.TestCase):
    """A couple of direct checks on the pure helpers (mirrors of common.ts)."""

    def test_wrap_to_pi_half_open(self):
        self.assertAlmostEqual(ik.wrap_to_pi(math.pi), -math.pi)  # +PI wraps to -PI
        self.assertAlmostEqual(ik.wrap_to_pi(-math.pi), -math.pi)
        self.assertAlmostEqual(ik.wrap_to_pi(0.0), 0.0)
        self.assertAlmostEqual(ik.wrap_to_pi(3 * math.pi), -math.pi)

    def test_forward_kinematics_right_angle(self):
        # 2 bones, second joint bent +90deg -> effector at (1, 1).
        x, y = ik.forward_kinematics([1, 1], [0, math.pi / 2])
        self.assertAlmostEqual(x, 1.0)
        self.assertAlmostEqual(y, 1.0)

    def test_dispatch_two_bone_reached(self):
        r = ik.solve_ik([1, 1], [1, 1])
        self.assertEqual(r["status"], "reached")
        self.assertEqual(r["iterations"], 0)  # analytical path


class SkeletonParsingTests(unittest.TestCase):
    """skeleton.json (#537) parsing + chain geometry."""

    def setUp(self):
        self.skel = ik.Skeleton.load(_ARM_SKELETON)

    def test_document_header(self):
        self.assertEqual(self.skel.schema_version, 1)
        self.assertEqual(self.skel.urdf_hash, "fnv1a-12345678")
        self.assertEqual(self.skel.robot, "test_arm")
        self.assertEqual(len(self.skel.joints), 4)
        self.assertIn("base_link", self.skel.links)

    def test_joint_fields(self):
        elbow = self.skel.joint("elbow")
        self.assertEqual(elbow.type, "revolute")
        self.assertEqual(elbow.parent, "upper_arm")
        self.assertEqual(elbow.child, "forearm")
        self.assertEqual(elbow.bone_length_mm, 60)
        self.assertEqual(elbow.axis, [0, 0, 1])
        self.assertTrue(elbow.is_rotational)

    def test_limits_degrees_to_radians(self):
        # shoulder limits are -90..90 deg -> -PI/2..PI/2 rad.
        lo, hi = self.skel.joint("shoulder").limit_radians()
        self.assertAlmostEqual(lo, -math.pi / 2)
        self.assertAlmostEqual(hi, math.pi / 2)
        # continuous joint has no angular limit.
        self.assertIsNone(self.skel.joint("wrist").limit_radians())
        # fixed joint has no angular limit either.
        self.assertIsNone(self.skel.joint("tip").limit_radians())

    def test_servo_binding_parse(self):
        elbow = self.skel.joint("elbow")
        self.assertIsNotNone(elbow.servo)
        self.assertEqual(elbow.servo.pin, "17")
        self.assertEqual(elbow.servo.joint_min, 0)
        self.assertEqual(elbow.servo.joint_max, 150)
        self.assertTrue(elbow.servo.invert)
        # wrist has no servo binding.
        self.assertIsNone(self.skel.joint("wrist").servo)

    def test_chain_bone_lengths_and_limits(self):
        chain = ["shoulder", "elbow", "wrist", "tip"]
        # bone i length = bone_length_mm of chain[i+1]: 60, 40, 30.
        self.assertEqual(self.skel.chain_bone_lengths(chain), [60, 40, 30])
        limits = self.skel.chain_limits(chain)
        # shoulder limited, elbow limited, wrist continuous (free).
        self.assertEqual(len(limits), 3)
        self.assertAlmostEqual(limits[0][0], -math.pi / 2)
        self.assertAlmostEqual(limits[1][1], 150 * math.pi / 180)
        self.assertIsNone(limits[2])

    def test_solve_via_skeleton_reaches(self):
        # Two-bone sub-chain shoulder->elbow->wrist: bones 60, 40.
        chain = ["shoulder", "elbow", "wrist"]
        # A comfortably reachable target within 60+40 mm.
        res = self.skel.solve(chain, [70, 30])
        self.assertEqual(res["status"], "reached")
        self.assertEqual(len(res["angles"]), 2)  # one angle per actuated joint

    def test_all_free_chain_limits_is_none(self):
        # A chain of only the continuous wrist + fixed tip -> no limits.
        limits = self.skel.chain_limits(["wrist", "tip"])
        self.assertIsNone(limits)


class _FakeServo:
    """Records every ``write_joint(rad)`` call — the snakie_motion.Servo shape."""

    def __init__(self, joint):
        self.joint = joint
        self.writes = []

    def write_joint(self, rad):
        self.writes.append(rad)
        return rad


class _FakeRig:
    """A snakie_motion.Rig stand-in: ``.servos()`` -> {name: servo}."""

    def __init__(self, servos):
        self._servos = servos

    def servos(self):
        return self._servos


class ApplyTests(unittest.TestCase):
    """apply() drives bound servos through a rig, and degrades without one."""

    def setUp(self):
        self.skel = ik.Skeleton.load(_ARM_SKELETON)
        self.chain = ["shoulder", "elbow", "wrist"]

    def test_apply_drives_bound_servos(self):
        shoulder = _FakeServo("shoulder")
        elbow = _FakeServo("elbow")
        rig = _FakeRig({"s0": shoulder, "s1": elbow})
        angles = [0.2, -0.4]
        driven = self.skel.apply(angles, chain=self.chain, rig=rig)
        # Both actuated joints in the chain are bound and driven, in order.
        self.assertEqual(driven, ["shoulder", "elbow"])
        self.assertEqual(shoulder.writes, [0.2])
        self.assertEqual(elbow.writes, [-0.4])

    def test_apply_uses_last_solved_chain(self):
        # solve() remembers the chain; apply() with no chain reuses it.
        res = self.skel.solve(self.chain, [70, 30])
        shoulder = _FakeServo("shoulder")
        elbow = _FakeServo("elbow")
        rig = _FakeRig({"a": shoulder, "b": elbow})
        driven = self.skel.apply(res["angles"], rig=rig)
        self.assertEqual(driven, ["shoulder", "elbow"])
        self.assertEqual(shoulder.writes[0], res["angles"][0])

    def test_apply_skips_unbound_and_tip_joints(self):
        # wrist has no servo; tip is the un-actuated chain end -> neither driven.
        full = ["shoulder", "elbow", "wrist", "tip"]
        shoulder = _FakeServo("shoulder")  # bone 0 base -> angle 0
        wrist = _FakeServo("wrist")  # bone 2 base -> angle 2
        rig = _FakeRig({"a": shoulder, "w": wrist})
        driven = self.skel.apply([0.1, 0.2, 0.3], chain=full, rig=rig)
        # shoulder (bone0) and wrist (bone2) are bound & actuated; elbow absent
        # from rig; tip has no angle.
        self.assertEqual(driven, ["shoulder", "wrist"])
        self.assertEqual(wrist.writes, [0.3])

    def test_apply_degrades_without_rig(self):
        # No rig passed and no snakie_motion-built rig would apply here; force the
        # no-rig path by handing an empty rig -> no servos, no crash, empty result.
        driven = self.skel.apply([0.1, 0.2], chain=self.chain, rig=_FakeRig({}))
        self.assertEqual(driven, [])

    def test_apply_no_chain_returns_empty(self):
        fresh = ik.Skeleton.load(_ARM_SKELETON)
        self.assertEqual(fresh.apply([0.1], rig=_FakeRig({})), [])

    def test_build_rig_from_snakie_motion(self):
        # The real integration path: build a snakie_motion.Rig from the bound
        # servos (headless — instruments guards `machine`), then apply.
        rig = self.skel.build_rig()
        self.assertIsNotNone(rig)  # shoulder + elbow are bound
        names = {s.joint for s in rig.servos().values()}
        self.assertEqual(names, {"shoulder", "elbow"})
        driven = self.skel.apply([0.1, 0.2], chain=self.chain, rig=rig)
        self.assertEqual(driven, ["shoulder", "elbow"])


if __name__ == "__main__":
    unittest.main()
