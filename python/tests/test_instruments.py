"""Unit tests for the device-side ``micropython/instruments.py`` telemetry lib.

These assert that ``scope`` / ``meter`` / ``plot`` (and the ``read_*``
convenience helpers, driven by a fake hardware object) print the EXACT
``SNK ...`` protocol lines the Snakie IDE parses. No board / ``machine`` module
is required: ``instruments.py`` is pure formatting + ``print`` and is loaded by
file path (mirroring ``test_python_linter.py``), so it imports under CPython.
Run from the repo root::

    PYTHONPATH=python python3 -m unittest discover -s python/tests
"""

import importlib.util
import io
import os
import sys
import unittest
from contextlib import redirect_stdout

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# The SDK package lives in python/; keep parity with the other test's setup.
sys.path.insert(0, os.path.join(_REPO_ROOT, "python"))

_LIB_PATH = os.path.join(_REPO_ROOT, "micropython", "instruments.py")
_spec = importlib.util.spec_from_file_location("snakie_instruments_under_test", _LIB_PATH)
assert _spec and _spec.loader
inst = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(inst)


def _emit(fn, *args, **kwargs):
    """Call ``fn`` capturing stdout; return the single printed line (no newline)."""
    buf = io.StringIO()
    with redirect_stdout(buf):
        fn(*args, **kwargs)
    out = buf.getvalue()
    # Each helper prints exactly one line.
    return out.rstrip("\n")


class _FakeADC:
    """Stand-in for ``machine.ADC`` exposing ``read_u16()``."""

    def __init__(self, u16):
        self._u16 = u16

    def read_u16(self):
        return self._u16


class _FakePWM:
    """Stand-in for ``machine.PWM`` exposing ``duty_u16()``."""

    def __init__(self, u16):
        self._u16 = u16

    def duty_u16(self):
        return self._u16


class ScopeOutput(unittest.TestCase):
    def test_default_channel(self):
        self.assertEqual(_emit(inst.scope, 12.5), "SNK SCOPE ch1 12.5")

    def test_named_channel(self):
        self.assertEqual(_emit(inst.scope, 0.75, ch="pwm"), "SNK SCOPE pwm 0.75")

    def test_integer_value(self):
        self.assertEqual(_emit(inst.scope, 3, ch="adc0"), "SNK SCOPE adc0 3")


class MeterOutput(unittest.TestCase):
    def test_default_channel_and_unit(self):
        self.assertEqual(_emit(inst.meter, 1.65), "SNK METER adc0 1.65 V")

    def test_named_channel(self):
        self.assertEqual(_emit(inst.meter, 3.3, ch="vsys"), "SNK METER vsys 3.3 V")

    def test_custom_unit(self):
        self.assertEqual(_emit(inst.meter, 25.0, ch="temp", unit="C"), "SNK METER temp 25.0 C")


class PlotOutput(unittest.TestCase):
    def test_bare_numbers(self):
        self.assertEqual(_emit(inst.plot, 1, 2, 3), "SNK PLOT 1 2 3")

    def test_named_series(self):
        self.assertEqual(_emit(inst.plot, temp=21.4, light=80), "SNK PLOT temp=21.4 light=80")

    def test_mixed_args_and_kwargs(self):
        self.assertEqual(_emit(inst.plot, 5, x=1), "SNK PLOT 5 x=1")

    def test_no_args(self):
        # An empty plot row is still a well-formed (empty-payload) PLOT line.
        self.assertEqual(_emit(inst.plot), "SNK PLOT ")


class ReadHelpers(unittest.TestCase):
    def test_read_adc_converts_and_emits(self):
        # 65535 -> full-scale 3.3 V; the helper meters it and returns the volts.
        line = _emit(inst.read_adc, _FakeADC(65535), ch="adc0")
        self.assertEqual(line, "SNK METER adc0 3.3 V")

    def test_read_adc_returns_volts(self):
        # Half scale (~32768) -> ~1.65 V; the return value is the volts.
        volts = inst.read_adc(_FakeADC(32768), ch="adc0")
        self.assertAlmostEqual(volts, 32768 / 65535 * 3.3, places=6)

    def test_read_pwm_emits_duty_fraction(self):
        # 32768 / 65535 -> 0.5 duty; scope-emitted on the given channel.
        line = _emit(inst.read_pwm, _FakePWM(32768), ch="pwm")
        self.assertEqual(line, "SNK SCOPE pwm %s" % (32768 / 65535))

    def test_read_pwm_returns_duty_fraction(self):
        duty = inst.read_pwm(_FakePWM(0), ch="pwm")
        self.assertEqual(duty, 0.0)


class Protocol(unittest.TestCase):
    def test_every_line_starts_with_sentinel(self):
        self.assertEqual(inst.SENTINEL, "SNK")
        for line in (
            _emit(inst.scope, 1),
            _emit(inst.meter, 1),
            _emit(inst.plot, 1),
        ):
            self.assertTrue(line.startswith("SNK "), line)

    def test_single_line_per_call(self):
        # No helper prints more than one line (loop-safe, one reading per print).
        buf = io.StringIO()
        with redirect_stdout(buf):
            inst.plot(a=1, b=2, c=3)
        self.assertEqual(buf.getvalue().count("\n"), 1)


if __name__ == "__main__":
    unittest.main()
