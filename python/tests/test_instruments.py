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
    """Stand-in for ``machine.PWM`` exposing ``duty_u16()`` + ``freq()``."""

    def __init__(self, u16, freq=1000):
        self._u16 = u16
        self._freq = freq

    def duty_u16(self):
        return self._u16

    def freq(self):
        return self._freq


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

    def test_read_pwm_emits_pwm_reading(self):
        # 32768 / 65535 -> 0.5 duty; emitted as a live PWM reading (freq + duty)
        # on the given channel so the scope draws the square wave at that duty.
        line = _emit(inst.read_pwm, _FakePWM(32768, freq=1000), ch="pwm")
        self.assertEqual(line, "SNK PWM pwm 1000 %s" % (32768 / 65535))

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
        inst.buzzer.stop()
        inst.buzzer.play_seq([(440, 10), (0, 5)])
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


class _RecordingPWM:
    """Stand-in for ``machine.PWM`` that records freq()/duty_u16() write calls."""

    def __init__(self):
        self.freqs = []        # every freq(n) written, in order
        self.duties = []       # every duty_u16(n) written, in order

    def freq(self, n):
        self.freqs.append(int(n))

    def duty_u16(self, n):
        self.duties.append(int(n))


class BuzzerDevice(unittest.TestCase):
    """The on-device Buzzer: stop/set_pin/play_seq + the ``buzzer`` receiver."""

    def test_stop_sets_duty_zero(self):
        pwm = _RecordingPWM()
        inst.Buzzer(pwm).stop()
        self.assertEqual(pwm.duties, [0])

    def test_set_volume_changes_sounding_duty(self):
        pwm = _RecordingPWM()
        buz = inst.Buzzer(pwm)
        buz.set_volume(1.0)
        buz.tone(440, 1)
        self.assertIn(65535, pwm.duties)  # full volume drives full duty
        pwm.duties = []
        buz.set_volume(0.0)
        buz.tone(440, 1)
        self.assertNotIn(65535, pwm.duties)  # silent: never raises the duty

    def test_buzzer_command_vol(self):
        pwm = _RecordingPWM()
        buz = inst.Buzzer(pwm)
        self.assertEqual(inst.buzzer_command("vol 0.5", buz), "vol")
        buz.tone(440, 1)
        self.assertIn(32767, pwm.duties)  # 0.5 * 65535 -> 32767

    def test_stop_without_pwm_is_noop(self):
        # No hardware → no crash, nothing recorded (there's nothing to record on).
        inst.Buzzer().stop()  # must not raise

    def test_set_pin_without_machine_is_inert(self):
        # No `machine` module under CPython → set_pin silences then stays inert,
        # leaving the existing pwm untouched (here None).
        buz = inst.Buzzer()
        buz.set_pin(15)  # must not raise
        self.assertIsNone(buz._pwm)

    def test_play_seq_drives_notes_and_rests(self):
        pwm = _RecordingPWM()
        inst.Buzzer(pwm).play_seq([(440, 5), (0, 5), (262, 5)])
        # Two real tones set a frequency; the rest (freq 0) sets none.
        self.assertEqual(pwm.freqs, [440, 262])
        # Each note: duty on (32768) then off (0); the rest: off only. Plus the
        # trailing inter-note 0s — every entry ends at duty 0.
        self.assertIn(32768, pwm.duties)
        self.assertEqual(pwm.duties[-1], 0)

    def test_parse_seq_pairs(self):
        self.assertEqual(inst.parse_seq("440:200,0:100"), [(440, 200), (0, 100)])
        # tolerates spaces + skips malformed pairs
        self.assertEqual(inst.parse_seq(" 440:200 , junk , 262:50 "), [(440, 200), (262, 50)])
        self.assertEqual(inst.parse_seq(""), [])

    def test_buzzer_command_tone(self):
        pwm = _RecordingPWM()
        buz = inst.Buzzer(pwm)
        self.assertEqual(inst.buzzer_command("tone 440 50", buz), "tone")
        self.assertEqual(pwm.freqs, [440])

    def test_buzzer_command_seq(self):
        pwm = _RecordingPWM()
        buz = inst.Buzzer(pwm)
        self.assertEqual(inst.buzzer_command("seq 440:5,0:5,262:5", buz), "seq")
        self.assertEqual(pwm.freqs, [440, 262])

    def test_buzzer_command_stop(self):
        pwm = _RecordingPWM()
        buz = inst.Buzzer(pwm)
        # prime a duty, then stop must drive it to 0
        pwm.duty_u16(32768)
        self.assertEqual(inst.buzzer_command("stop", buz), "stop")
        self.assertEqual(pwm.duties[-1], 0)

    def test_buzzer_command_unknown_and_empty(self):
        self.assertIsNone(inst.buzzer_command("wat", inst.Buzzer(_RecordingPWM())))
        self.assertIsNone(inst.buzzer_command("", inst.Buzzer(_RecordingPWM())))

    def test_servo_command_angle(self):
        pwm = _RecordingPWM()
        srv = inst.Servo(pwm)
        self.assertEqual(inst.servo_command("angle 90", srv), "angle")
        self.assertEqual(srv.angle_deg, 90)
        # 90° → 1.5 ms of a 20 ms frame → duty ~0.075 → ~4915 u16.
        self.assertAlmostEqual(pwm.duties[-1], round(1500 / 20000 * 65535), delta=2)

    def test_servo_command_angle_clamps(self):
        srv = inst.Servo(_RecordingPWM())
        inst.servo_command("angle 999", srv)
        self.assertEqual(srv.angle_deg, 180)
        inst.servo_command("angle -20", srv)
        self.assertEqual(srv.angle_deg, 0)

    def test_servo_command_detach(self):
        pwm = _RecordingPWM()
        srv = inst.Servo(pwm)
        inst.servo_command("angle 90", srv)
        self.assertEqual(inst.servo_command("detach", srv), "detach")
        self.assertEqual(pwm.duties[-1], 0)

    def test_servo_command_unknown_and_empty(self):
        srv = inst.Servo(_RecordingPWM())
        self.assertIsNone(inst.servo_command("wat", srv))
        self.assertIsNone(inst.servo_command("", srv))

    def test_buzzer_receiver_via_control_feed(self):
        # Feed real SNKCMD buzzer lines through a Control wired to a fake-PWM
        # Buzzer — the registered handler must actuate it (end-to-end protocol).
        pwm = _RecordingPWM()
        buz = inst.Buzzer(pwm)
        ctrl = inst.Control()
        ctrl._poll = None  # feed-only
        ctrl.on("buzzer", lambda payload: inst.buzzer_command(payload, buz))
        ctrl.feed("SNKCMD buzzer tone 440 5\n")
        ctrl.feed("SNKCMD buzzer seq 262:5,0:5,330:5\n")
        ctrl.feed("SNKCMD buzzer stop\n")
        self.assertEqual(pwm.freqs, [440, 262, 330])
        self.assertEqual(pwm.duties[-1], 0)

    def test_start_with_buzzer_pin_registers_receiver(self):
        # start(buzzer_pin=...) must register the `buzzer` handler (set_pin stays
        # inert under CPython, but the receiver is wired). Suppress the READY line.
        with redirect_stdout(io.StringIO()):
            inst.start(background=False, buzzer_pin=15)
        self.assertIn("buzzer", inst.control._handlers)


class _FakeRangefinder:
    """Stand-in for ``Rangefinder`` recording the last ``set_pins`` call."""

    def __init__(self):
        self.pins = None       # the (trig, echo) of the last set_pins call

    def set_pins(self, trig, echo):
        self.pins = (int(trig), int(echo))


class RangefinderDevice(unittest.TestCase):
    """The on-device HC-SR04 rangefinder: _us_to_mm, read(), the `range` receiver."""

    def test_us_to_mm_halves_the_round_trip(self):
        # 343 m/s -> 0.343 mm/µs, halved for the round trip -> 0.1715 mm/µs.
        self.assertEqual(inst._us_to_mm(0), 0)
        self.assertEqual(inst._us_to_mm(1000), int(1000 * 0.1715))  # 171
        # A ~58 µs round trip ≈ 1 cm (the classic HC-SR04 rule of thumb).
        self.assertEqual(inst._us_to_mm(58), int(58 * 0.1715))  # 9 mm
        # Always an int (cheap to print + stable for the radar).
        self.assertIsInstance(inst._us_to_mm(2000), int)

    def test_read_without_pins_returns_none(self):
        # A fresh Rangefinder has no pins -> read() degrades to None (no crash).
        self.assertIsNone(inst.Rangefinder().read())

    def test_read_without_machine_returns_none(self):
        # No `machine` module under CPython -> set_pins is inert (no pins set), so
        # read() returns None and never raises.
        rf = inst.Rangefinder()
        rf.set_pins(3, 2)  # inert under CPython
        self.assertIsNone(rf.read())
        self.assertIsNone(rf._trig)
        self.assertIsNone(rf._echo)

    def test_range_command_pins_parsing(self):
        rf = _FakeRangefinder()
        self.assertEqual(inst.range_command("pins 3 2", rf), "pins")
        self.assertEqual(rf.pins, (3, 2))

    def test_range_command_against_real_rangefinder(self):
        # A real Rangefinder under CPython: set_pins is inert (no machine), but the
        # command must still parse + dispatch + return the verb without raising.
        rf = inst.Rangefinder()
        self.assertEqual(inst.range_command("pins 5 4", rf), "pins")

    def test_range_command_unknown_empty_and_malformed(self):
        rf = _FakeRangefinder()
        self.assertIsNone(inst.range_command("wat", rf))
        self.assertIsNone(inst.range_command("", rf))
        self.assertIsNone(inst.range_command("pins 3", rf))      # missing echo
        self.assertIsNone(inst.range_command("pins a b", rf))    # non-numeric
        self.assertIsNone(rf.pins)  # nothing actuated on a bad payload

    def test_range_command_defaults_to_ranger_singleton(self):
        # No `rf` -> defaults to the shared `ranger` (inert set_pins under CPython,
        # but the dispatch + verb return must work).
        self.assertEqual(inst.range_command("pins 1 0"), "pins")

    def test_range_receiver_via_control_feed(self):
        # Feed a real SNKCMD range line through a Control wired to a fake Rangefinder
        # — the registered handler must actuate it (end-to-end protocol).
        rf = _FakeRangefinder()
        ctrl = inst.Control()
        ctrl._poll = None  # feed-only
        ctrl.on("range", lambda payload: inst.range_command(payload, rf))
        ctrl.feed("SNKCMD range pins 3 2\n")
        self.assertEqual(rf.pins, (3, 2))

    def test_start_with_range_pins_registers_receiver(self):
        # start(range_trig=, range_echo=) must register the `range` handler (set_pins
        # stays inert under CPython, but the receiver is wired). Suppress READY.
        with redirect_stdout(io.StringIO()):
            inst.start(background=False, range_trig=3, range_echo=2)
        self.assertIn("range", inst.control._handlers)
        # The wired handler dispatches a `range pins …` line to the singleton.
        self.assertEqual(inst.range_command("pins 7 6"), "pins")


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


class BackgroundService(unittest.TestCase):
    """The 2nd-core service: readiness announce, ping reply, scan handlers."""

    def test_ready_announces_default_caps(self):
        self.assertEqual(
            _emit(inst.ready),
            "SNK READY scan:wifi scan:bt teleop led buzzer range screen servo watch",
        )

    def test_ready_includes_extra_caps(self):
        line = _emit(inst.ready, ("scan:i2c",))
        self.assertTrue(line.startswith("SNK READY "))
        self.assertIn("scan:i2c", line.split())

    def test_start_registers_handlers_and_announces(self):
        out = _emit(inst.start, background=False)
        self.assertIn("SNK READY", out)
        for target in ("scan:wifi", "scan:bt", "ping"):
            self.assertIn(target, inst.control._handlers)
        self.assertNotIn("scan:i2c", inst.control._handlers)

    def test_start_with_i2c_registers_i2c_scan(self):
        with redirect_stdout(io.StringIO()):
            inst.start(background=False, i2c=_FakeI2C([0x3C]))
        self.assertIn("scan:i2c", inst.control._handlers)
        # The scan:i2c trigger runs the bus scan and emits its result set.
        buf = io.StringIO()
        with redirect_stdout(buf):
            inst.control.feed("SNKCMD scan:i2c\n")
        self.assertIn("SNK I2C 0x3C", buf.getvalue())

    def test_ping_command_triggers_ready(self):
        with redirect_stdout(io.StringIO()):
            inst.start(background=False)
        buf = io.StringIO()
        with redirect_stdout(buf):
            inst.control.feed("SNKCMD ping\n")
        self.assertIn("SNK READY", buf.getvalue())

    def test_scan_wifi_command_fires_handler_without_radio(self):
        # No `network` module under CPython → wifi_scan emits nothing, but the
        # registered handler must run without raising.
        with redirect_stdout(io.StringIO()):
            inst.start(background=False)
        buf = io.StringIO()
        with redirect_stdout(buf):
            inst.control.feed("SNKCMD scan:wifi\n")
        self.assertEqual(buf.getvalue(), "")


class LibraryVersion(unittest.TestCase):
    """The IDE parses `__version__ = "X.Y.Z"` to offer board-library updates."""

    def test_has_string_version(self):
        self.assertIsInstance(inst.__version__, str)
        self.assertTrue(inst.__version__)

    def test_version_is_dotted_numeric(self):
        parts = inst.__version__.split(".")
        self.assertTrue(all(p.isdigit() for p in parts), inst.__version__)


class ControlHeartbeat(unittest.TestCase):
    """poll() emits a SNK READY heartbeat (the IDE's presence signal)."""

    def test_poll_emits_ready_with_handler_caps(self):
        c = inst.Control()
        c.on("buzzer", lambda p: None)
        buf = io.StringIO()
        with redirect_stdout(buf):
            c.poll()
        self.assertIn("SNK READY", buf.getvalue())
        self.assertIn("buzzer", buf.getvalue())

    def test_poll_does_not_heartbeat_twice_immediately(self):
        c = inst.Control()
        with redirect_stdout(io.StringIO()):
            c.poll()  # first beat
        buf = io.StringIO()
        with redirect_stdout(buf):
            c.poll()  # within 2 s -> no second beat (and no stdin on CPython)
        self.assertEqual(buf.getvalue(), "")


class StartNoThread(unittest.TestCase):
    """start() defaults to main-loop polling — it must NOT spawn a thread."""

    def test_start_does_not_run_background_by_default(self):
        with redirect_stdout(io.StringIO()):
            inst.start(buzzer_pin=15)
        self.assertFalse(inst._service_running)
        self.assertIn("buzzer", inst.control._handlers)


class BluetoothScan(unittest.TestCase):
    """BLE advertising-name decode + bt_scan's graceful no-radio degradation."""

    def test_decode_complete_local_name(self):
        adv = bytes([0x05, 0x09]) + b"Tag1"  # len=5 (type+4 name), 0x09 = complete
        self.assertEqual(inst._decode_adv_name(adv), "Tag1")

    def test_decode_shortened_local_name(self):
        adv = bytes([0x03, 0x08]) + b"Hi"  # 0x08 = shortened
        self.assertEqual(inst._decode_adv_name(adv), "Hi")

    def test_decode_skips_other_ad_structures(self):
        adv = bytes([0x02, 0x01, 0x06]) + bytes([0x04, 0x09]) + b"Bob"  # flags, then name
        self.assertEqual(inst._decode_adv_name(adv), "Bob")

    def test_decode_no_name_is_empty(self):
        self.assertEqual(inst._decode_adv_name(b""), "")
        self.assertEqual(inst._decode_adv_name(bytes([0x02, 0x01, 0x06])), "")

    def test_bt_scan_degrades_without_radio(self):
        # No usable BLE radio under CPython -> no SNK output, returns a list.
        buf = io.StringIO()
        with redirect_stdout(buf):
            result = inst.bt_scan(1)
        self.assertEqual(result, [])
        self.assertEqual(buf.getvalue(), "")


class _FakeDisplay:
    """Stand-in for ``Display`` recording the last set_pins/set_addr/text call."""

    def __init__(self):
        self.pins = None       # the (sda, scl) of the last set_pins call
        self.addr = None       # the last set_addr argument
        self.rows = None       # the rows of the last text() call
        self.spi = None        # the (sck, mosi, dc, rst, cs, w, h) of set_spi

    def set_pins(self, sda, scl):
        self.pins = (int(sda), int(scl))

    def set_spi(self, sck, mosi, dc, rst, cs, w=240, h=240):
        self.spi = (int(sck), int(mosi), int(dc), int(rst), int(cs), int(w), int(h))

    def set_addr(self, addr):
        self.addr = int(addr)

    def text(self, lines):
        self.rows = list(lines)


class I2CPinMux(unittest.TestCase):
    """The RP2040 I²C SDA/SCL pin mux backing the IDE's invalid-pin warning."""

    def test_valid_block0_pairs(self):
        # Block 0: SDA∈{0,4,8,12,16,20}, SCL∈{1,5,9,13,17,21}.
        self.assertEqual(inst._i2c_block_for_pins(0, 1), 0)
        self.assertEqual(inst._i2c_block_for_pins(4, 5), 0)
        self.assertEqual(inst._i2c_block_for_pins(20, 21), 0)
        # Cross-pairs WITHIN the block are still valid (any SDA + any SCL of block).
        self.assertEqual(inst._i2c_block_for_pins(0, 13), 0)

    def test_valid_block1_pairs(self):
        # Block 1: SDA∈{2,6,10,14,18,26}, SCL∈{3,7,11,15,19,27}.
        self.assertEqual(inst._i2c_block_for_pins(2, 3), 1)
        self.assertEqual(inst._i2c_block_for_pins(6, 7), 1)
        self.assertEqual(inst._i2c_block_for_pins(26, 27), 1)
        self.assertEqual(inst._i2c_block_for_pins(14, 3), 1)

    def test_cross_block_pairs_are_invalid(self):
        # A block-0 SDA with a block-1 SCL (and vice versa) is NOT a valid pair.
        self.assertIsNone(inst._i2c_block_for_pins(0, 3))   # SDA b0, SCL b1
        self.assertIsNone(inst._i2c_block_for_pins(2, 1))   # SDA b1, SCL b0
        # Same-role swap (SCL pin used as SDA) is invalid too.
        self.assertIsNone(inst._i2c_block_for_pins(1, 0))

    def test_unknown_pins_are_invalid(self):
        self.assertIsNone(inst._i2c_block_for_pins(28, 22))  # not an I²C pin
        self.assertIsNone(inst._i2c_block_for_pins("a", "b"))  # non-numeric
        self.assertIsNone(inst._i2c_block_for_pins(None, None))


class SpiPinMux(unittest.TestCase):
    """The RP2040 SPI SCK/MOSI pin mux backing the ST7789 panel's invalid-pin warning."""

    def test_valid_block0_pairs(self):
        # Block 0: SCK∈{2,6,18,22}, MOSI∈{3,7,19,23}.
        self.assertEqual(inst._spi_block_for_pins(2, 3), 0)
        self.assertEqual(inst._spi_block_for_pins(18, 19), 0)
        self.assertEqual(inst._spi_block_for_pins(22, 23), 0)

    def test_valid_block1_pairs(self):
        # Block 1: SCK∈{10,14,26}, MOSI∈{11,15,27}.
        self.assertEqual(inst._spi_block_for_pins(10, 11), 1)
        self.assertEqual(inst._spi_block_for_pins(14, 15), 1)
        self.assertEqual(inst._spi_block_for_pins(26, 27), 1)

    def test_cross_block_and_unknown_are_invalid(self):
        self.assertIsNone(inst._spi_block_for_pins(18, 11))   # SCK b0, MOSI b1
        self.assertIsNone(inst._spi_block_for_pins(10, 19))   # SCK b1, MOSI b0
        self.assertIsNone(inst._spi_block_for_pins(19, 18))   # roles swapped
        self.assertIsNone(inst._spi_block_for_pins(0, 1))     # I²C pins
        self.assertIsNone(inst._spi_block_for_pins("a", "b"))  # non-numeric


class DisplaySpiDevice(unittest.TestCase):
    """The on-device ST7789 SPI display: set_spi fallback, the `screen spi` verb."""

    def test_set_spi_inert_without_machine(self):
        # No `machine` under CPython -> set_spi builds no panel but never raises,
        # and re-labels the SNK SCR echo as `st7789`.
        disp = inst.Display()
        disp.set_spi(18, 19, 16, 20, 17, 240, 240)
        self.assertIsNone(disp._oled)
        self.assertEqual(disp._addr, "st7789")

    def test_set_spi_accepts_tied_cs(self):
        # cs = -1 (tied) is accepted the same as a real pin (still inert here).
        disp = inst.Display()
        disp.set_spi(18, 19, 16, 20, -1, 240, 320)
        self.assertIsNone(disp._oled)

    def test_text_after_set_spi_echoes_st7789_label(self):
        disp = inst.Display()
        disp.set_spi(18, 19, 16, 20, -1)
        line = _emit(disp.text, ["Snakie", "ready"])
        self.assertEqual(line, "SNK SCR st7789 text Snakie ready")

    def test_screen_command_spi_parsing(self):
        disp = _FakeDisplay()
        self.assertEqual(
            inst.screen_command("spi 18 19 16 20 17 240 320", disp), "spi"
        )
        self.assertEqual(disp.spi, (18, 19, 16, 20, 17, 240, 320))

    def test_screen_command_spi_defaults_size_and_tied_cs(self):
        disp = _FakeDisplay()
        # Omitted cs/w/h default to -1 (tied) / 240 / 240.
        self.assertEqual(inst.screen_command("spi 10 11 12 13", disp), "spi")
        self.assertEqual(disp.spi, (10, 11, 12, 13, -1, 240, 240))

    def test_screen_command_spi_malformed(self):
        disp = _FakeDisplay()
        self.assertIsNone(inst.screen_command("spi 18", disp))       # missing pins
        self.assertIsNone(inst.screen_command("spi a b c d", disp))  # non-numeric
        self.assertIsNone(disp.spi)

    def test_start_with_screen_spi_registers_receiver(self):
        # start(screen_sck=, screen_mosi=) must register the `screen` handler
        # (set_spi stays inert under CPython, but the receiver is wired).
        with redirect_stdout(io.StringIO()):
            inst.start(background=False, screen_sck=18, screen_mosi=19,
                       screen_dc=16, screen_rst=20, screen_cs=17)
        self.assertIn("screen", inst.control._handlers)
        # The wired handler dispatches a `screen spi …` line to the singleton.
        self.assertEqual(inst.screen_command("spi 18 19 16 20 17 240 240"), "spi")


class DisplayDevice(unittest.TestCase):
    """The on-device SSD1306 display: set_pins fallback, the `screen` receiver."""

    def test_set_pins_inert_without_machine(self):
        # No `machine`/`framebuf` under CPython -> set_pins is inert (no panel),
        # but never raises and the address label is still updated.
        disp = inst.Display()
        disp.set_pins(0, 1, addr=0x3D)
        self.assertIsNone(disp._i2c)
        self.assertIsNone(disp._oled)
        self.assertEqual(disp._addr, "0x3D")

    def test_text_echoes_telemetry_without_hardware(self):
        # With no panel attached, text() is purely the SNK SCR telemetry echo.
        line = _emit(inst.Display().text, ["Hello world", "Line 2"])
        self.assertEqual(line, "SNK SCR 0x3C text Hello_world Line_2")

    def test_screen_command_pins_parsing(self):
        disp = _FakeDisplay()
        self.assertEqual(inst.screen_command("pins 0 1", disp), "pins")
        self.assertEqual(disp.pins, (0, 1))

    def test_screen_command_addr_parsing(self):
        disp = _FakeDisplay()
        self.assertEqual(inst.screen_command("addr 0x3D", disp), "addr")
        self.assertEqual(disp.addr, 0x3D)
        # A decimal address parses too.
        self.assertEqual(inst.screen_command("addr 60", disp), "addr")
        self.assertEqual(disp.addr, 60)

    def test_screen_command_text_decodes_rows(self):
        disp = _FakeDisplay()
        # Underscores decode back to spaces (matching the SNK SCR text packing).
        self.assertEqual(inst.screen_command("text Hello_world Line_2", disp), "text")
        self.assertEqual(disp.rows, ["Hello world", "Line 2"])
        # A bare `text` clears the display (no rows).
        self.assertEqual(inst.screen_command("text", disp), "text")
        self.assertEqual(disp.rows, [])

    def test_screen_command_against_real_display(self):
        # A real Display under CPython: set_pins is inert (no machine), but the
        # command must still parse + dispatch + return the verb without raising.
        disp = inst.Display()
        self.assertEqual(inst.screen_command("pins 2 3", disp), "pins")

    def test_screen_command_text_emits_scr_without_machine(self):
        # text via the receiver still emits SNK SCR even with no hardware (graceful
        # degrade — the IDE mirror keeps working on a board with no panel attached).
        disp = inst.Display()
        buf = io.StringIO()
        with redirect_stdout(buf):
            inst.screen_command("text Hi_there", disp)
        self.assertEqual(buf.getvalue().rstrip("\n"), "SNK SCR 0x3C text Hi_there")

    def test_screen_command_unknown_empty_and_malformed(self):
        disp = _FakeDisplay()
        self.assertIsNone(inst.screen_command("wat", disp))
        self.assertIsNone(inst.screen_command("", disp))
        self.assertIsNone(inst.screen_command("pins 0", disp))     # missing scl
        self.assertIsNone(inst.screen_command("pins a b", disp))   # non-numeric
        self.assertIsNone(inst.screen_command("addr", disp))       # missing addr
        self.assertIsNone(disp.pins)  # nothing actuated on a bad payload

    def test_screen_command_defaults_to_display_singleton(self):
        # No `disp` -> defaults to the shared `display` (inert set_pins under
        # CPython, but the dispatch + verb return must work).
        self.assertEqual(inst.screen_command("pins 0 1"), "pins")

    def test_screen_receiver_via_control_feed(self):
        # Feed a real SNKCMD screen line through a Control wired to a fake Display.
        disp = _FakeDisplay()
        ctrl = inst.Control()
        ctrl._poll = None  # feed-only
        ctrl.on("screen", lambda payload: inst.screen_command(payload, disp))
        ctrl.feed("SNKCMD screen pins 2 3\n")
        self.assertEqual(disp.pins, (2, 3))

    def test_start_with_screen_pins_registers_receiver(self):
        # start(screen_sda=, screen_scl=) must register the `screen` handler
        # (set_pins stays inert under CPython, but the receiver is wired).
        with redirect_stdout(io.StringIO()):
            inst.start(background=False, screen_sda=0, screen_scl=1)
        self.assertIn("screen", inst.control._handlers)
        # The wired handler dispatches a `screen pins …` line to the singleton.
        self.assertEqual(inst.screen_command("pins 4 5"), "pins")


class _FakeWatchPWM:
    """Stand-in for ``machine.PWM``: freq() + duty_u16() getters/setters."""

    def __init__(self, freq=50, duty=0.075):
        self._f = freq
        self._d = int(duty * 65535)

    def freq(self, v=None):
        if v is None:
            return self._f
        self._f = v

    def duty_u16(self, v=None):
        if v is None:
            return self._d
        self._d = v


class _FakeServoObj:
    """A user Servo-like driver: exposes ``angle()``."""

    def __init__(self):
        self.a = 90

    def angle(self, v):
        self.a = int(v)
        return self.a


class _FakeBme:
    """A user env-sensor driver (BME280-shaped): t/p/h properties + read()."""

    def __init__(self, t=21.5, p=1013.2, h=45.0):
        self._t, self._p, self._h = t, p, h

    @property
    def temperature(self):
        return self._t

    @property
    def pressure(self):
        return self._p

    @property
    def humidity(self):
        return self._h

    def read(self):
        return (self._t, self._p, self._h)


class _FakeIMU:
    """A user IMU driver (ICM20948-shaped): accel/gyro + optional magnetometer."""

    def __init__(self, accel=(0.0, 0.0, 1.0), gyro=(0.0, 0.0, 0.0), mag=None):
        self._a = accel
        self._g = gyro
        self._m = mag

    def read_accel(self):
        return self._a

    def read_gyro(self):
        return self._g

    def read_accel_gyro(self):
        return self._a + self._g

    @property
    def mag_supported(self):
        return self._m is not None

    def read_mag(self):
        if self._m is None:
            raise RuntimeError("no magnetometer")
        return self._m


class WatchBinding(unittest.TestCase):
    """`watch`/`update`/`watch_command` — bind real objects, classify by duck type."""

    def setUp(self):
        inst._watched.clear()

    def test_classify_by_duck_type(self):
        self.assertEqual(inst._classify(_FakeWatchPWM()), "pwm")
        self.assertEqual(inst._classify(_FakeADC(32768)), "adc")
        self.assertEqual(inst._classify(_FakeServoObj()), "servo")
        self.assertEqual(inst._classify(_FakeI2C([0x3C])), "i2c")
        self.assertEqual(inst._classify(_FakeIMU()), "imu")
        self.assertEqual(inst._classify(_FakeBme()), "env")
        self.assertIsNone(inst._classify(object()))

    def test_watch_imu_emits_bind(self):
        self.assertEqual(_emit(inst.watch, imu=_FakeIMU()), "SNK BIND imu imu")

    def test_watch_env_emits_bind_and_update_streams(self):
        self.assertEqual(_emit(inst.watch, weather=_FakeBme()), "SNK BIND weather env")
        buf = io.StringIO()
        with redirect_stdout(buf):
            inst.update()
        line = buf.getvalue().strip()
        self.assertEqual(line, "SNK ENV weather 21.5 1013.2 45.0")

    def test_env_emit_function(self):
        self.assertEqual(_emit(inst.env, 21.5, 1013.2, 45.0), "SNK ENV env 21.5 1013.2 45.0")
        self.assertEqual(
            _emit(inst.env, 20, 990, 60, ch="attic"), "SNK ENV attic 20 990 60"
        )

    def test_update_imu_flat_board(self):
        # Flat, still board: accel (0, 0, 1) g → roll 0, pitch 0; no mag → yaw 0.
        inst.watch(imu=_FakeIMU(accel=(0.0, 0.0, 1.0)))
        buf = io.StringIO()
        with redirect_stdout(buf):
            inst.update()
        line = buf.getvalue().strip()
        self.assertTrue(line.startswith("SNK IMU imu "))
        _, _, _, roll, pitch, yaw = line.split()
        self.assertAlmostEqual(float(roll), 0.0, places=3)
        self.assertAlmostEqual(float(pitch), 0.0, places=3)
        self.assertAlmostEqual(float(yaw), 0.0, places=3)

    def test_update_imu_tilt_and_heading(self):
        # Tilted right (accel 0,1,0 → roll 90°) with mag (1,1,0) → yaw atan2(1,1)=45°.
        inst.watch(imu=_FakeIMU(accel=(0.0, 1.0, 0.0), mag=(1.0, 1.0, 0.0)))
        buf = io.StringIO()
        with redirect_stdout(buf):
            inst.update()
        _, _, _, roll, _pitch, yaw = buf.getvalue().strip().split()
        self.assertAlmostEqual(float(roll), 90.0, places=2)
        self.assertAlmostEqual(float(yaw), 45.0, places=2)

    def test_watch_emits_bind_descriptors(self):
        out = _emit(inst.watch, pwm=_FakeWatchPWM())
        self.assertEqual(out, "SNK BIND pwm pwm")
        # Positional form works too.
        self.assertEqual(_emit(inst.watch, "pot", _FakeADC(32768)), "SNK BIND pot adc")
        self.assertIn("pwm", inst._watched)
        self.assertIn("pot", inst._watched)

    def test_update_reuses_existing_telemetry(self):
        inst.watch(pwm=_FakeWatchPWM(freq=50, duty=0.075), pot=_FakeADC(32768))
        buf = io.StringIO()
        with redirect_stdout(buf):
            inst.update()
        lines = buf.getvalue().strip().split("\n")
        # PWM → the existing scope/servo telemetry (freq + duty ~0.075 after the
        # duty_u16 round-trip); ADC → the existing meter telemetry.
        self.assertTrue(any(l.startswith("SNK PWM pwm 50 0.07") for l in lines))
        self.assertTrue(any(l.startswith("SNK METER pot ") and l.endswith(" V") for l in lines))

    def test_watch_command_drives_the_bound_object(self):
        pwm = _FakeWatchPWM()
        srv = _FakeServoObj()
        inst.watch(pwm=pwm, servo=srv)
        self.assertEqual(inst.watch_command("pwm duty 0.25"), "duty")
        self.assertEqual(pwm.duty_u16(), int(0.25 * 65535))
        self.assertEqual(inst.watch_command("servo angle 120"), "angle")
        self.assertEqual(srv.a, 120)

    def test_watch_command_ignores_unknown_or_malformed(self):
        inst.watch(pwm=_FakeWatchPWM())
        self.assertIsNone(inst.watch_command("nope angle 5"))  # unknown name
        self.assertIsNone(inst.watch_command("pwm"))            # no verb
        self.assertIsNone(inst.watch_command(""))               # empty
        self.assertIsNone(inst.watch_command("pwm bogus 1"))    # unknown verb

    def test_start_registers_the_watch_receiver(self):
        with redirect_stdout(io.StringIO()):
            inst.start(background=False)
        self.assertIn("watch", inst.control._handlers)


if __name__ == "__main__":
    unittest.main()
