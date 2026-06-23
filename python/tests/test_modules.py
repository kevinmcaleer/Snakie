"""Unit tests for the bundled device-side driver stubs (``micropython/modules/*.py``).

These assert the PURE logic split out of each Snakie module #120 driver — the
maths/parsing that runs identically under CPython without a ``machine`` module
(no board needed). Each module is loaded BY FILE PATH (mirroring
``test_instruments.py``) so the lazy ``from machine import …`` inside the driver
classes is never triggered. Run from the repo root::

    PYTHONPATH=python python3 -m unittest discover -s python/tests
"""

import importlib.util
import os
import unittest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_MODULES_DIR = os.path.join(_REPO_ROOT, "micropython", "modules")


def _load(name, filename):
    """Load a bundled module by file path (so ``import machine`` stays lazy)."""
    path = os.path.join(_MODULES_DIR, filename)
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


hcsr04 = _load("snakie_hcsr04", "hcsr04.py")
mpu6050 = _load("snakie_mpu6050", "mpu6050.py")
neo = _load("snakie_neopixel", "neopixel_ws2812.py")
rotary = _load("snakie_rotary", "rotary.py")
buzzer = _load("snakie_buzzer", "buzzer.py")
teleop = _load("snakie_teleop", "teleop.py")


class TestHcsr04(unittest.TestCase):
    def test_echo_to_distance_mm(self):
        # ~5800 us round trip ~= 1 m. distance = us * 0.343 / 2.
        self.assertAlmostEqual(hcsr04.echo_to_distance_mm(5800), 994.7, places=1)

    def test_timeout_is_out_of_range(self):
        self.assertEqual(hcsr04.echo_to_distance_mm(-1), -1)
        self.assertEqual(hcsr04.echo_to_distance_mm(None), -1)


class TestMpu6050(unittest.TestCase):
    def test_raw_to_g_signed(self):
        # +1 g at the default ±2 g full scale = +16384 LSB = 0x4000.
        self.assertAlmostEqual(mpu6050.raw_to_g(0x40, 0x00), 1.0, places=4)
        # -1 g = -16384 = 0xC000 two's complement.
        self.assertAlmostEqual(mpu6050.raw_to_g(0xC0, 0x00), -1.0, places=4)

    def test_raw_to_dps(self):
        # 131 LSB/dps -> 131 raw = 1 dps.
        self.assertAlmostEqual(mpu6050.raw_to_dps(0x00, 0x83), 1.0, places=2)

    def test_accel_to_euler_flat(self):
        # Flat (gravity straight down on +z) -> ~0 roll, ~0 pitch, 0 yaw.
        roll, pitch, yaw = mpu6050.accel_to_euler(0.0, 0.0, 1.0)
        self.assertAlmostEqual(roll, 0.0, places=3)
        self.assertAlmostEqual(pitch, 0.0, places=3)
        self.assertEqual(yaw, 0.0)

    def test_accel_to_euler_tilt(self):
        # Tilted onto +y -> roll ~= 90 deg.
        roll, _pitch, _yaw = mpu6050.accel_to_euler(0.0, 1.0, 0.0)
        self.assertAlmostEqual(roll, 90.0, places=2)


class TestNeoPixel(unittest.TestCase):
    def test_scale_clamps(self):
        self.assertEqual(neo.scale((100, 200, 50), 0.5), (50, 100, 25))
        self.assertEqual(neo.scale((255, 255, 255), 2.0), (255, 255, 255))
        self.assertEqual(neo.scale((255, 255, 255), -1.0), (0, 0, 0))

    def test_wheel_wraps_and_returns_rgb(self):
        c = neo.wheel(300)  # wraps to 44
        self.assertEqual(len(c), 3)
        self.assertTrue(all(0 <= ch <= 255 for ch in c))


class TestRotary(unittest.TestCase):
    def test_step_delta_directions(self):
        # One clockwise quadrature step: 0b00 -> 0b10 = +1; the reverse = -1.
        self.assertEqual(rotary.step_delta(0b00, 0b10), 1)
        self.assertEqual(rotary.step_delta(0b10, 0b00), -1)

    def test_step_delta_no_move_and_bounce(self):
        self.assertEqual(rotary.step_delta(0b00, 0b00), 0)
        # An invalid diagonal transition (bounce) = 0.
        self.assertEqual(rotary.step_delta(0b00, 0b11), 0)


class TestBuzzer(unittest.TestCase):
    def test_note_to_freq_a4(self):
        self.assertEqual(buzzer.note_to_freq("a", 4), 440)

    def test_note_to_freq_sharp_and_rest(self):
        # C#5 is one semitone above C5 (~523 -> ~554 Hz).
        self.assertEqual(buzzer.note_to_freq("c#", 5), 554)
        self.assertEqual(buzzer.note_to_freq("p", 5), 0)

    def test_parse_rtttl(self):
        notes = buzzer.parse_rtttl("t:d=4,o=5,b=120:c,8e,g")
        self.assertEqual(len(notes), 3)
        # b=120 -> whole note 2000 ms; quarter = 500 ms, eighth = 250 ms.
        self.assertEqual(notes[0][1], 500)
        self.assertEqual(notes[1][1], 250)
        # First note is C5.
        self.assertEqual(notes[0][0], buzzer.note_to_freq("c", 5))


class TestTeleop(unittest.TestCase):
    def test_clamp(self):
        self.assertEqual(teleop.clamp(2.0), 1.0)
        self.assertEqual(teleop.clamp(-2.0), -1.0)
        self.assertEqual(teleop.clamp(0.3), 0.3)

    def test_arcade_mix_straight(self):
        # Full throttle, no steering -> both wheels full forward.
        self.assertEqual(teleop.arcade_mix(1.0, 0.0), (1.0, 1.0))

    def test_arcade_mix_spin(self):
        # Pure steering -> wheels oppose (spin in place).
        left, right = teleop.arcade_mix(0.0, 1.0)
        self.assertEqual((left, right), (1.0, -1.0))


if __name__ == "__main__":
    unittest.main()
