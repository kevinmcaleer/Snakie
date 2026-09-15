"""Unit tests for the device-side ``micropython/turtle.py`` telemetry lib.

These assert that the turtle commands print the EXACT ``SNK TURT ...``
protocol lines the Snakie IDE's Turtle instrument parses. No board is
required: ``turtle.py`` is pure state + ``print`` and is loaded by file path
(mirroring ``test_instruments.py``), so it imports under CPython. Run from
the repo root::

    PYTHONPATH=python python3 -m unittest discover -s python/tests
"""

import importlib.util
import io
import os
import sys
import unittest
from contextlib import redirect_stdout

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "python"))

_LIB_PATH = os.path.join(_REPO_ROOT, "micropython", "turtle.py")
_spec = importlib.util.spec_from_file_location("snakie_turtle_under_test", _LIB_PATH)
assert _spec and _spec.loader
turt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(turt)


def _emit(fn, *args, **kwargs):
    """Call ``fn`` capturing stdout; return the printed lines (no trailing newline)."""
    buf = io.StringIO()
    with redirect_stdout(buf):
        fn(*args, **kwargs)
    out = buf.getvalue()
    return out.rstrip("\n").split("\n") if out else []


class FreshTurtle(unittest.TestCase):
    """Every test gets its own :class:`Turtle` — the module-level default
    turtle already emitted its start-up ``POS`` line at import time, so
    constructing a fresh one keeps each test's captured output to just the
    call under test's own lines."""

    def setUp(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.t = turt.Turtle()  # swallow the constructor's initial POS line


class ForwardOutput(FreshTurtle):
    def test_forward_from_origin_heading_north_moves_up(self):
        lines = _emit(self.t.forward, 10)
        self.assertEqual(
            lines,
            [
                "SNK TURT LINE 0 0 0 10 white 2",
                "SNK TURT POS 0 10 0",
            ],
        )
        self.assertEqual(self.t.position(), (0, 10))

    def test_forward_does_not_change_heading(self):
        self.t.forward(5)
        self.assertEqual(self.t.heading, 0)

    def test_backward_moves_opposite_heading(self):
        lines = _emit(self.t.backward, 10)
        self.assertEqual(
            lines,
            [
                "SNK TURT LINE 0 0 0 -10 white 2",
                "SNK TURT POS 0 -10 0",
            ],
        )

    def test_pen_up_move_emits_no_line(self):
        self.t.penup()
        lines = _emit(self.t.forward, 10)
        self.assertEqual(lines, ["SNK TURT POS 0 10 0"])


class HeadingOutput(FreshTurtle):
    def test_right_90_faces_east(self):
        lines = _emit(self.t.right, 90)
        self.assertEqual(lines, ["SNK TURT POS 0 0 90"])
        self.assertEqual(self.t.heading, 90)

    def test_forward_after_right_90_moves_east(self):
        self.t.right(90)
        lines = _emit(self.t.forward, 10)
        self.assertEqual(
            lines,
            [
                "SNK TURT LINE 0 0 10 0 white 2",
                "SNK TURT POS 10 0 90",
            ],
        )

    def test_left_90_faces_west(self):
        lines = _emit(self.t.left, 90)
        self.assertEqual(lines, ["SNK TURT POS 0 0 270"])

    def test_heading_wraps_to_0_360(self):
        self.t.right(350)
        lines = _emit(self.t.right, 20)
        self.assertEqual(lines, ["SNK TURT POS 0 0 10"])

    def test_setheading_is_absolute(self):
        self.t.right(45)
        lines = _emit(self.t.setheading, 180)
        self.assertEqual(lines, ["SNK TURT POS 0 0 180"])


class PenOutput(FreshTurtle):
    def test_penup_emits_pen_0(self):
        self.assertEqual(_emit(self.t.penup), ["SNK TURT PEN 0"])
        self.assertFalse(self.t.pen)

    def test_pendown_emits_pen_1(self):
        self.t.penup()
        self.assertEqual(_emit(self.t.pendown), ["SNK TURT PEN 1"])
        self.assertTrue(self.t.pen)

    def test_pencolor_and_pensize_affect_the_next_line(self):
        self.t.pencolor("red")
        self.t.pensize(5)
        lines = _emit(self.t.forward, 3)
        self.assertEqual(lines[0], "SNK TURT LINE 0 0 0 3 red 5")

    def test_pencolor_with_spaces_is_underscore_encoded(self):
        self.t.pencolor("light green")
        lines = _emit(self.t.forward, 1)
        self.assertEqual(lines[0], "SNK TURT LINE 0 0 0 1 light_green 2")


class PositionOutput(FreshTurtle):
    def test_goto_draws_a_line_when_pen_down(self):
        lines = _emit(self.t.goto, 5, 5)
        self.assertEqual(
            lines,
            [
                "SNK TURT LINE 0 0 5 5 white 2",
                "SNK TURT POS 5 5 0",
            ],
        )

    def test_goto_with_pen_up_moves_without_a_line(self):
        self.t.penup()
        lines = _emit(self.t.goto, -3, -4)
        self.assertEqual(lines, ["SNK TURT POS -3 -4 0"])

    def test_home_returns_to_origin_and_north(self):
        self.t.goto(5, 5)
        self.t.right(90)
        lines = _emit(self.t.home)
        self.assertEqual(
            lines,
            [
                "SNK TURT LINE 5 5 0 0 white 2",
                "SNK TURT POS 0 0 90",
                "SNK TURT POS 0 0 0",
            ],
        )

    def test_clear_emits_clear_only(self):
        self.assertEqual(_emit(self.t.clear), ["SNK TURT CLEAR"])

    def test_reset_clears_then_homes(self):
        self.t.goto(1, 1)
        lines = _emit(self.t.reset)
        self.assertEqual(lines[0], "SNK TURT CLEAR")
        self.assertEqual(lines[-1], "SNK TURT POS 0 0 0")


class VisibilityOutput(FreshTurtle):
    def test_hideturtle_emits_vis_0(self):
        self.assertEqual(_emit(self.t.hideturtle), ["SNK TURT VIS 0"])
        self.assertFalse(self.t.visible)

    def test_showturtle_emits_vis_1(self):
        self.t.hideturtle()
        self.assertEqual(_emit(self.t.showturtle), ["SNK TURT VIS 1"])
        self.assertTrue(self.t.visible)


class SpeedGetSet(FreshTurtle):
    def test_default_speed(self):
        self.assertEqual(self.t.speed(), 6)

    def test_set_speed(self):
        self.t.speed(1)
        self.assertEqual(self.t.speed(), 1)

    def test_speed_emits_no_telemetry(self):
        self.assertEqual(_emit(self.t.speed, 3), [])


class ModuleLevelApi(unittest.TestCase):
    """The module-level functions (``forward``/``right``/…) drive one shared
    default turtle, exactly like CPython's ``turtle`` module."""

    def test_module_functions_drive_the_shared_default(self):
        turt.reset()
        buf = io.StringIO()
        with redirect_stdout(buf):
            turt.forward(10)
            turt.right(90)
        self.assertEqual(turt.position(), (0, 10))
        self.assertEqual(turt._default.heading, 90)

    def test_short_aliases(self):
        self.assertIs(turt.fd, turt.forward)
        self.assertIs(turt.bk, turt.backward)
        self.assertIs(turt.back, turt.backward)
        self.assertIs(turt.rt, turt.right)
        self.assertIs(turt.lt, turt.left)
        self.assertIs(turt.pu, turt.penup)
        self.assertIs(turt.pd, turt.pendown)


class VersionMarker(unittest.TestCase):
    def test_version_is_a_plain_string_literal(self):
        # Kept parseable without importing (mirrors instruments.py's contract).
        self.assertRegex(turt.__version__, r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()
