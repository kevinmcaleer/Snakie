"""Unit tests for the Motion Studio managed-block reader (#413).

These exercise ``snakie.host._motion_read`` / ``_motion_check`` — the AST +
``ast.literal_eval`` reader that pulls a robot's pose library, sequences and
servo map back out of an exported ``.py``. Run from the repo root::

    PYTHONPATH=python python3 -m unittest discover -s python/tests

The reader is exec-safe (only ``literal_eval`` of the recognised ``SNAKIE_*``
assignments), so a hostile or hand-broken file never runs user code.
"""

import os
import sys
import unittest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "python"))

from snakie import host  # noqa: E402


def read(source: str) -> dict:
    return host._motion_read({"source": source})


VALID = """\
\"\"\"My robot.\"\"\"
import instruments as inst

# --- snakie:poses v1 --- managed by Snakie Motion Studio
SNAKIE_POSES = { "wave": { "shoulder": 45.0, "elbow": -20.0 }, "rest": { "shoulder": 0.0, "elbow": 0.0 } }
SNAKIE_SEQUENCES = { "hello": [ ["wave", 500], ["rest", 500] ] }
# --- snakie:poses:end ---

# --- snakie:servos v1 --- managed by Snakie Motion Studio
SNAKIE_SERVOS = [ { "pin": "GP0", "joint": "shoulder", "jointMin": 0.0, "jointMax": 180.0, "invert": True } ]
# --- snakie:servos:end ---

inst.servo_on(0).angle(90)
"""


class MotionReadValidTests(unittest.TestCase):
    def test_reads_poses_sequences_and_servos(self) -> None:
        res = read(VALID)
        self.assertTrue(res["ok"])
        self.assertEqual(res["schema"], 1)
        self.assertEqual(res["poses"]["wave"], {"shoulder": 45.0, "elbow": -20.0})
        self.assertEqual(res["poses"]["rest"], {"shoulder": 0.0, "elbow": 0.0})
        self.assertEqual(res["sequences"]["hello"], [["wave", 500.0], ["rest", 500.0]])
        self.assertEqual(len(res["servos"]), 1)
        servo = res["servos"][0]
        self.assertEqual(servo["pin"], "GP0")
        self.assertEqual(servo["joint"], "shoulder")
        self.assertEqual(servo["jointMin"], 0.0)
        self.assertEqual(servo["jointMax"], 180.0)
        self.assertIs(servo["invert"], True)
        self.assertEqual(res["warnings"], [])

    def test_missing_blocks_are_empty_not_an_error(self) -> None:
        res = read("print('no managed blocks here')\n")
        self.assertTrue(res["ok"])
        self.assertEqual(res["poses"], {})
        self.assertEqual(res["sequences"], {})
        self.assertEqual(res["servos"], [])

    def test_does_not_execute_user_code(self) -> None:
        # A managed name assigned to a CALL is not a literal — it must be skipped
        # (never evaluated), which for _motion_read means an error result.
        malicious = (
            "# --- snakie:poses v1 ---\n"
            "SNAKIE_POSES = __import__('os').system('touch /tmp/snakie_pwned')\n"
            "# --- snakie:poses:end ---\n"
        )
        res = read(malicious)
        self.assertFalse(res["ok"])
        self.assertFalse(os.path.exists("/tmp/snakie_pwned"))


class MotionReadGuardTests(unittest.TestCase):
    def test_newer_schema_block_is_skipped_with_a_warning(self) -> None:
        src = (
            "# --- snakie:poses v99 --- from a newer Snakie\n"
            'SNAKIE_POSES = { "future": { "j": 1 } }\n'
            "SNAKIE_SEQUENCES = {}\n"
            "# --- snakie:poses:end ---\n"
        )
        res = read(src)
        self.assertTrue(res["ok"])
        # The future block's data is NOT surfaced (we don't understand it)…
        self.assertEqual(res["poses"], {})
        # …and a warning explains why.
        self.assertTrue(any("newer than this app" in w for w in res["warnings"]))

    def test_syntax_error_is_a_soft_failure(self) -> None:
        res = read("def broken(:\n    pass\n")
        self.assertFalse(res["ok"])
        self.assertIn("syntax error", res["error"])

    def test_non_literal_value_fails_and_pauses_sync(self) -> None:
        src = (
            "# --- snakie:servos v1 ---\n"
            "SNAKIE_SERVOS = build_servos()\n"  # a call, not a literal
            "# --- snakie:servos:end ---\n"
        )
        res = read(src)
        self.assertFalse(res["ok"])
        self.assertIn("not a plain literal", res["error"])


class MotionReadShapeTests(unittest.TestCase):
    def test_bad_shaped_entries_are_dropped_not_fatal(self) -> None:
        src = (
            "# --- snakie:poses v1 ---\n"
            'SNAKIE_POSES = { "good": { "j": 5 }, "bad": [1, 2, 3] }\n'
            'SNAKIE_SEQUENCES = { "s": [ ["good", 100], ["oops"], "nope" ] }\n'
            "# --- snakie:poses:end ---\n"
            "# --- snakie:servos v1 ---\n"
            'SNAKIE_SERVOS = [ { "pin": "GP1", "joint": "j" }, { "no": "pin" } ]\n'
            "# --- snakie:servos:end ---\n"
        )
        res = read(src)
        self.assertTrue(res["ok"])
        self.assertIn("good", res["poses"])
        self.assertNotIn("bad", res["poses"])  # wrong shape dropped
        self.assertEqual(res["sequences"]["s"], [["good", 100.0]])  # only the valid step
        self.assertEqual(len(res["servos"]), 1)  # the pin-less entry dropped
        self.assertEqual(res["servos"][0]["pin"], "GP1")


class MotionReadRobustnessTests(unittest.TestCase):
    def test_out_of_range_int_is_a_soft_drop_not_a_raise(self) -> None:
        # A ~321-digit int passes ast.literal_eval but float() would OverflowError;
        # the reader must drop it (never raise to the JSON-RPC loop).
        huge = "1" + "0" * 320
        for assign in (
            'SNAKIE_POSES = { "p": { "j": ' + huge + " } }",
            'SNAKIE_SEQUENCES = { "s": [ ["p", ' + huge + "] ] }",
            'SNAKIE_SERVOS = [ { "pin": "GP0", "joint": "j", "jointMax": ' + huge + " } ]",
        ):
            res = read(
                "# --- snakie:poses v1 ---\n" + assign + "\n# --- snakie:poses:end ---\n"
            )
            self.assertTrue(res["ok"], assign)  # soft-handled, not a crash

    def test_out_of_range_pose_value_is_dropped(self) -> None:
        huge = "1" + "0" * 320
        res = read(
            "# --- snakie:poses v1 ---\n"
            'SNAKIE_POSES = { "p": { "good": 45, "bad": ' + huge + " } }\n"
            "# --- snakie:poses:end ---\n"
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["poses"]["p"], {"good": 45.0})  # only the finite value

    def test_sequence_step_keeps_an_optional_easing_third_element(self) -> None:
        # #415 exports [pose, ms, easing]; the reader must carry the easing (and
        # still accept the legacy 2-tuple form).
        res = read(
            "# --- snakie:sequences v1 ---\n"
            'SNAKIE_SEQUENCES = { "walk": [ ["a", 0, "linear"], ["b", 500, "easeInOut"], ["c", 200] ] }\n'
            "# --- snakie:sequences:end ---\n"
        )
        self.assertTrue(res["ok"])
        self.assertEqual(
            res["sequences"]["walk"],
            [["a", 0.0, "linear"], ["b", 500.0, "easeInOut"], ["c", 200.0]],
        )

    def test_boolean_values_are_rejected_not_coerced(self) -> None:
        # bool subclasses int; True must NOT become 1.0 in a numeric slot.
        res = read(
            "# --- snakie:poses v1 ---\n"
            'SNAKIE_POSES = { "p": { "j": True } }\n'
            "# --- snakie:poses:end ---\n"
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["poses"]["p"], {})  # the boolean was dropped, not coerced


class MotionCheckTests(unittest.TestCase):
    def test_check_reports_ok_and_schema_without_data(self) -> None:
        res = host._motion_check({"source": VALID})
        self.assertTrue(res["ok"])
        self.assertEqual(res["schema"], 1)
        self.assertNotIn("poses", res)

    def test_check_reports_a_broken_file(self) -> None:
        res = host._motion_check({"source": "x = (\n"})
        self.assertFalse(res["ok"])
        self.assertTrue(res["error"])


if __name__ == "__main__":
    unittest.main()
