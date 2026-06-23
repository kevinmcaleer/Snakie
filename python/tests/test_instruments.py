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


class ImuOutput(unittest.TestCase):
    def test_euler_default_channel(self):
        self.assertEqual(_emit(inst.imu, 0.0, 1.2, 90.0), "SNK IMU imu 0.0 1.2 90.0")

    def test_euler_named_channel(self):
        self.assertEqual(_emit(inst.imu, 1, 2, 3, ch="head"), "SNK IMU head 1 2 3")

    def test_quaternion(self):
        self.assertEqual(
            _emit(inst.imu_quat, 1.0, 0.0, 0.0, 0.0), "SNK IMUQ imu 1.0 0.0 0.0 0.0"
        )

    def test_quaternion_named_channel(self):
        self.assertEqual(
            _emit(inst.imu_quat, 0, 0, 0, 1, ch="q"), "SNK IMUQ q 0 0 0 1"
        )


class DistanceOutput(unittest.TestCase):
    def test_distance_no_angle(self):
        self.assertEqual(_emit(inst.distance, 123), "SNK DIST dist 123")

    def test_distance_with_angle(self):
        self.assertEqual(_emit(inst.distance, 250, angle=45), "SNK DIST dist 250 45")

    def test_distance_named_channel(self):
        self.assertEqual(_emit(inst.distance, 12, ch="lidar"), "SNK DIST lidar 12")


class ButtonEncoderOutput(unittest.TestCase):
    def test_button_down(self):
        self.assertEqual(_emit(inst.button, "a", True), "SNK BTN a 1")

    def test_button_up(self):
        self.assertEqual(_emit(inst.button, "start", 0), "SNK BTN start 0")

    def test_button_coerces_truthy(self):
        self.assertEqual(_emit(inst.button, "x", 5), "SNK BTN x 1")

    def test_encoder_count_only(self):
        self.assertEqual(_emit(inst.encoder, 17), "SNK ENC enc 17")

    def test_encoder_with_press(self):
        self.assertEqual(_emit(inst.encoder, -3, ch="dial", pressed=True), "SNK ENC dial -3 1")

    def test_encoder_press_false(self):
        self.assertEqual(_emit(inst.encoder, 0, pressed=False), "SNK ENC enc 0 0")


class ScreenOutput(unittest.TestCase):
    def test_text_rows_encode_spaces(self):
        line = _emit(inst.screen, ["Hello world", "Line 2"])
        self.assertEqual(line, "SNK SCR 0x3C text Hello_world Line_2")

    def test_text_custom_addr(self):
        line = _emit(inst.screen, ["Hi"], addr="0x3D")
        self.assertEqual(line, "SNK SCR 0x3D text Hi")

    def test_framebuffer(self):
        line = _emit(inst.screen_fb, "AAEC", 8, 8)
        self.assertEqual(line, "SNK SCR 0x3C fb 8 8 b64 AAEC")

    def test_framebuffer_rle(self):
        line = _emit(inst.screen_fb, "3x0,2x1", 4, 4, addr="0x70", encoding="rle")
        self.assertEqual(line, "SNK SCR 0x70 fb 4 4 rle 3x0,2x1")


class _FakeI2C:
    """Stand-in for ``machine.I2C`` exposing ``scan()``."""

    def __init__(self, addrs):
        self._addrs = addrs

    def scan(self):
        return list(self._addrs)


class ScannerOutput(unittest.TestCase):
    def test_i2c_scan_emits_hex_addresses(self):
        line = _emit(inst.i2c_scan, _FakeI2C([0x3C, 0x68]))
        self.assertEqual(line, "SNK I2C 0x3C 0x68")

    def test_i2c_scan_empty_bus(self):
        line = _emit(inst.i2c_scan, _FakeI2C([]))
        self.assertEqual(line, "SNK I2C")

    def test_i2c_scan_returns_addresses(self):
        self.assertEqual(inst.i2c_scan(_FakeI2C([1, 2])), [1, 2])

    def test_wifi_scan_no_radio_is_silent(self):
        # No `network` module under CPython -> degrades to no output, returns [].
        buf = io.StringIO()
        with redirect_stdout(buf):
            result = inst.wifi_scan()
        self.assertEqual(buf.getvalue(), "")
        self.assertEqual(result, [])

    def test_bt_scan_no_radio_is_silent(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            result = inst.bt_scan()
        self.assertEqual(buf.getvalue(), "")
        self.assertEqual(result, [])

    def test_emit_bt(self):
        line = _emit(inst.emit_bt, "My Device", "AA:BB:CC", -57)
        self.assertEqual(line, "SNK BT My_Device AA:BB:CC -57")


class ControlParsing(unittest.TestCase):
    def test_parse_control_line_target_and_payload(self):
        self.assertEqual(
            inst.parse_control_line("SNKCMD led pwm 0.5"), ("led", "pwm 0.5")
        )

    def test_parse_control_line_target_only(self):
        self.assertEqual(inst.parse_control_line("SNKCMD scan:i2c"), ("scan:i2c", ""))

    def test_parse_control_line_strips_whitespace(self):
        self.assertEqual(
            inst.parse_control_line("  SNKCMD teleop axes=lx:0.5  \r\n"),
            ("teleop", "axes=lx:0.5"),
        )

    def test_parse_control_line_rejects_non_control(self):
        self.assertIsNone(inst.parse_control_line("hello world"))
        self.assertIsNone(inst.parse_control_line("SNK SCOPE pwm 0.5"))
        self.assertIsNone(inst.parse_control_line("SNKCMD"))
        self.assertIsNone(inst.parse_control_line(""))

    def test_parse_axes(self):
        self.assertEqual(
            inst.parse_axes("axes=lx:0.5,ly:-0.2,rx:1.0"),
            {"lx": 0.5, "ly": -0.2, "rx": 1.0},
        )

    def test_parse_axes_ignores_other_tokens_and_bad_numbers(self):
        self.assertEqual(inst.parse_axes("btn:a=1 axes=x:nan_no,y:2"), {"y": 2.0})

    def test_parse_axes_empty(self):
        self.assertEqual(inst.parse_axes(""), {})
        self.assertEqual(inst.parse_axes("btn:a=1"), {})

    def test_parse_pressed(self):
        self.assertTrue(inst.parse_pressed("axes=lx:0.5 btn:a=1", "a"))
        self.assertFalse(inst.parse_pressed("axes=lx:0.5 btn:a=1", "b"))
        self.assertFalse(inst.parse_pressed("", "a"))


class ControlChannel(unittest.TestCase):
    def setUp(self):
        # A fresh Control with no stdin poller, driven via feed() for determinism.
        self.ctrl = inst.Control()
        self.ctrl._poll = None  # force the inert/feed-only path

    def test_latest_wins_per_target(self):
        self.ctrl.feed("SNKCMD led on\nSNKCMD led off\n")
        self.assertEqual(self.ctrl.get("led"), "off")

    def test_separate_targets_kept(self):
        self.ctrl.feed("SNKCMD led on\nSNKCMD buzzer tone 440 200\n")
        self.assertEqual(self.ctrl.get("led"), "on")
        self.assertEqual(self.ctrl.get("buzzer"), "tone 440 200")

    def test_partial_line_buffered_across_feeds(self):
        self.ctrl.feed("SNKCMD tel")
        self.assertIsNone(self.ctrl.get("teleop"))
        self.ctrl.feed("eop axes=lx:1.0\n")
        self.assertEqual(self.ctrl.axes("teleop"), {"lx": 1.0})

    def test_non_control_lines_ignored(self):
        self.ctrl.feed("regular print\nSNK SCOPE pwm 0.5\nSNKCMD led on\n")
        self.assertEqual(self.ctrl.get("led"), "on")
        self.assertIsNone(self.ctrl.get("pwm"))

    def test_axes_and_pressed(self):
        self.ctrl.feed("SNKCMD teleop axes=lx:0.5,ly:-0.2 btn:a=1\n")
        self.assertEqual(self.ctrl.axes("teleop"), {"lx": 0.5, "ly": -0.2})
        self.assertTrue(self.ctrl.pressed("teleop", "a"))
        self.assertFalse(self.ctrl.pressed("teleop", "b"))

    def test_unknown_target_get_is_none(self):
        self.assertIsNone(self.ctrl.get("nope"))
        self.assertEqual(self.ctrl.axes("nope"), {})

    def test_handler_fires_on_update(self):
        seen = []
        self.ctrl.on("scan:i2c", lambda payload: seen.append(payload))
        self.ctrl.feed("SNKCMD scan:i2c\n")
        self.assertEqual(seen, [""])

    def test_poll_is_safe_without_stdin(self):
        # poll() with no poller must not raise and not consume anything.
        self.ctrl.poll()
        self.assertIsNone(self.ctrl.get("led"))


class Receivers(unittest.TestCase):
    def test_teleop_reads_axes(self):
        ctrl = inst.Control()
        ctrl._poll = None
        ctrl.feed("SNKCMD teleop axes=lx:0.5 btn:a=1\n")
        axes, payload = inst.teleop("teleop", ctrl=ctrl)
        self.assertEqual(axes, {"lx": 0.5})
        self.assertEqual(payload, "axes=lx:0.5 btn:a=1")

    def test_buzzer_and_led_are_noop_without_hardware(self):
        # Hardware-less singletons: calls must not raise.
        inst.buzzer.tone(440, 50)
        self.assertEqual(inst.buzzer.play("c4"), "c4")
        inst.led.set(True)
        inst.led.pwm(0.5)
        inst.led.rgb(255, 0, 0)

    def test_led_pwm_sets_duty(self):
        class _PWM:
            def __init__(self):
                self.duty = None

            def duty_u16(self, v):
                self.duty = v

        pwm = _PWM()
        inst.Led(pwm=pwm).pwm(1.0)
        self.assertEqual(pwm.duty, 65535)

    def test_screen_text_echoes_telemetry(self):
        line = _emit(inst.Screen().text, ["Hi there"])
        self.assertEqual(line, "SNK SCR 0x3C text Hi_there")


class Protocol(unittest.TestCase):
    def test_every_line_starts_with_sentinel(self):
        self.assertEqual(inst.SENTINEL, "SNK")
        self.assertEqual(inst.CONTROL_SENTINEL, "SNKCMD")
        for line in (
            _emit(inst.scope, 1),
            _emit(inst.meter, 1),
            _emit(inst.plot, 1),
            _emit(inst.imu, 1, 2, 3),
            _emit(inst.distance, 1),
            _emit(inst.button, "a", 1),
            _emit(inst.encoder, 1),
            _emit(inst.screen, ["x"]),
        ):
            self.assertTrue(line.startswith("SNK "), line)

    def test_single_line_per_call(self):
        # No emitter prints more than one line (loop-safe, one reading per print).
        for fn, args in (
            (inst.plot, (1, 2, 3)),
            (inst.imu, (1, 2, 3)),
            (inst.imu_quat, (1, 2, 3, 4)),
            (inst.distance, (1, 2)),
            (inst.button, ("a", 1)),
            (inst.encoder, (1, "enc", True)),
            (inst.screen, (["a", "b"],)),
            (inst.screen_fb, ("AAA", 8, 8)),
        ):
            buf = io.StringIO()
            with redirect_stdout(buf):
                fn(*args)
            self.assertEqual(buf.getvalue().count("\n"), 1, fn.__name__)


if __name__ == "__main__":
    unittest.main()
