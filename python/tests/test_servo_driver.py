"""Unit tests for the bundled SG90 driver ``examples/.../sg90/servo.py``.

The driver is MicroPython (it ``from machine import Pin, PWM``), but it's pure
Python logic, so we inject a tiny fake ``machine`` module and load it by file
path (mirroring ``test_instruments.py``) to run it under CPython.

The key behaviour under test: ``Servo`` accepts a GPIO number, a ``Pin`` OR an
already-made ``PWM``, so ``base = Servo(PWM(Pin(0)))`` reads pin -> PWM -> Servo.

Run from the repo root::

    PYTHONPATH=python python3 -m unittest discover -s python/tests
"""

import importlib.util
import os
import sys
import types
import unittest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DRIVER = os.path.join(
    _REPO_ROOT, "examples", "parts", "snakie-standard", "sg90", "servo.py"
)


class _Pin:
    def __init__(self, n):
        self.n = n


class _PWM:
    def __init__(self, pin):
        self.pin = pin
        self.freq_hz = None
        self.duty = None

    def freq(self, f):
        self.freq_hz = f

    def duty_u16(self, d):
        self.duty = d

    def deinit(self):
        pass


def _load_servo():
    """Load servo.py fresh with a fake ``machine`` module in place."""
    machine = types.ModuleType("machine")
    machine.Pin = _Pin
    machine.PWM = _PWM
    saved = sys.modules.get("machine")
    sys.modules["machine"] = machine
    try:
        spec = importlib.util.spec_from_file_location("servo_under_test", _DRIVER)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        if saved is not None:
            sys.modules["machine"] = saved
        else:
            del sys.modules["machine"]


class ServoConstructionTests(unittest.TestCase):
    def setUp(self):
        self.servo = _load_servo()

    def test_accepts_bare_pin_number(self):
        s = self.servo.Servo(16)
        self.assertIsInstance(s._pwm, _PWM)
        self.assertEqual(s._pwm.pin.n, 16)
        self.assertEqual(s._pwm.freq_hz, 50)  # 50 Hz servo timing set

    def test_accepts_a_pin_object(self):
        s = self.servo.Servo(_Pin(5))
        self.assertIsInstance(s._pwm, _PWM)
        self.assertEqual(s._pwm.pin.n, 5)

    def test_accepts_an_existing_pwm_used_as_is(self):
        my_pwm = _PWM(_Pin(0))
        s = self.servo.Servo(my_pwm)
        self.assertIs(s._pwm, my_pwm)  # the SAME PWM, not a fresh one
        self.assertEqual(s._pwm.freq_hz, 50)

    def test_drives_the_given_pwm(self):
        my_pwm = _PWM(_Pin(0))
        s = self.servo.Servo(my_pwm)
        s.angle(90)
        self.assertIsNotNone(my_pwm.duty)  # angle() wrote to the shared PWM
        self.assertEqual(s.angle(), 90)


if __name__ == "__main__":
    unittest.main()
