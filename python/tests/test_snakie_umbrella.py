"""Unit tests for the on-device ``snakie`` hardware umbrella.

``micropython/snakie.py`` re-exports the *hardware* classes from ``instruments``
so board code can ``from snakie import Servo, Buzzer, Led, Pin, PWM`` — a friendly,
collision-proof name (a vendor ``servo`` module can't shadow it).

NOTE: we load it by FILE PATH, not ``import snakie`` — under ``PYTHONPATH=python``
a bare ``import snakie`` resolves to the HOST-side ``python/snakie`` package (the
IDE SDK), which is a different thing in a different runtime. Both modules import
cleanly under CPython (``instruments`` guards its ``machine`` import).

Run from the repo root::

    PYTHONPATH=python python3 -m unittest discover -s python/tests
"""

import importlib.util
import os
import sys
import unittest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_MPY = os.path.join(_REPO_ROOT, "micropython")
_HARDWARE = ("Servo", "Buzzer", "Led", "Pin", "PWM")


def _load_by_path(modname, filename):
    spec = importlib.util.spec_from_file_location(modname, os.path.join(_MPY, filename))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[modname] = mod  # so `from instruments import …` inside snakie.py resolves
    spec.loader.exec_module(mod)
    return mod


class SnakieUmbrellaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Register the DEVICE instruments under the name snakie.py imports, then
        # load the umbrella by path (avoids the host `python/snakie` collision).
        cls.instruments = _load_by_path("instruments", "instruments.py")
        cls.snakie = _load_by_path("snakie_umbrella_under_test", "snakie.py")

    def test_reexports_hardware_as_the_same_objects(self):
        for name in _HARDWARE:
            self.assertIs(
                getattr(self.snakie, name),
                getattr(self.instruments, name),
                "snakie.%s should be the same object as instruments.%s" % (name, name),
            )

    def test_all_lists_exactly_the_hardware_classes(self):
        self.assertEqual(set(self.snakie.__all__), set(_HARDWARE))

    def test_measurement_tools_stay_in_instruments(self):
        # Scopes/meters/plotters are NOT re-exported — they're how you observe the
        # hardware, not hardware you wire up.
        self.assertFalse(hasattr(self.snakie, "scope"))
        self.assertFalse(hasattr(self.snakie, "meter"))

    def test_servo_still_accepts_a_pwm_through_the_umbrella(self):
        pwm = self.snakie.PWM(self.snakie.Pin(0))
        s = self.snakie.Servo(pwm, pin=0)
        self.assertIs(s._pwm, pwm)


if __name__ == "__main__":
    unittest.main()
