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
lsm6ds3 = _load("snakie_lsm6ds3", "lsm6ds3.py")
tb6612 = _load("snakie_tb6612", "tb6612.py")
grove_us = _load("snakie_grove_ultrasonic", "grove_ultrasonic.py")
pcf8563 = _load("snakie_pcf8563", "pcf8563.py")


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


class TestLsm6ds3(unittest.TestCase):
    def test_output_is_little_endian(self):
        # The LSM6DS3 emits low byte first — the OPPOSITE of the MPU-6050. Read
        # with the wrong order, 0x4000 would decode as 0x0040 and look plausible.
        self.assertEqual(lsm6ds3._twos16(0x00, 0x40), 0x4000)
        self.assertEqual(lsm6ds3._twos16(0x00, 0xC0), -16384)

    def test_raw_to_g_scales_with_range(self):
        # 0.061 mg/LSB at +-2 g: 16384 LSB ~= 1 g.
        self.assertAlmostEqual(lsm6ds3.raw_to_g(0x00, 0x40, 2), 0.99942, places=4)
        # +-16 g is 8x coarser, so the SAME raw count reads 8x larger.
        self.assertAlmostEqual(
            lsm6ds3.raw_to_g(0x00, 0x40, 16), 8 * lsm6ds3.raw_to_g(0x00, 0x40, 2), places=4
        )

    def test_raw_to_dps_scales_with_range(self):
        # 8.75 mdps/LSB at 245 dps.
        self.assertAlmostEqual(lsm6ds3.raw_to_dps(0x64, 0x00, 245), 0.875, places=4)
        # 2000 dps is 8x coarser than 245.
        self.assertAlmostEqual(lsm6ds3.raw_to_dps(0x64, 0x00, 2000), 7.0, places=4)

    def test_accel_full_scale_bits_are_not_sequential(self):
        # The trap: +-16 g sits at 0b01, between 2 g and 4 g. Assuming a
        # sequential 2/4/8/16 order mis-scales every range except +-2 g.
        self.assertEqual(lsm6ds3.ctrl1_xl(104, 2), 0x40 | 0x00)
        self.assertEqual(lsm6ds3.ctrl1_xl(104, 16), 0x40 | 0x04)
        self.assertEqual(lsm6ds3.ctrl1_xl(104, 4), 0x40 | 0x08)
        self.assertEqual(lsm6ds3.ctrl1_xl(104, 8), 0x40 | 0x0C)

    def test_gyro_125dps_uses_its_own_enable_bit(self):
        # 125 dps is NOT a value of the FS_G field — it is a separate bit, and
        # FS_G must read 0 beside it.
        self.assertEqual(lsm6ds3.ctrl2_g(104, 125), 0x40 | 0x02)
        self.assertEqual(lsm6ds3.ctrl2_g(104, 245), 0x40 | 0x00)
        self.assertEqual(lsm6ds3.ctrl2_g(104, 2000), 0x40 | 0x0C)

    def test_rejects_unsupported_settings(self):
        with self.assertRaises(ValueError):
            lsm6ds3.ctrl1_xl(104, 3)
        with self.assertRaises(ValueError):
            lsm6ds3.ctrl2_g(999, 245)

    def test_whoami_accepts_both_variants(self):
        self.assertIn(0x69, lsm6ds3.WHO_AM_I_VALUES)


class TestTb6612(unittest.TestCase):
    def test_run_frame_direction_and_magnitude(self):
        # [cmd, channel, speed]; 0x02 = clockwise, 0x03 = counter-clockwise.
        self.assertEqual(tb6612.run_frame(tb6612.CH_A, 200), b"\x02\x00\xc8")
        self.assertEqual(tb6612.run_frame(tb6612.CH_B, -200), b"\x03\x01\xc8")

    def test_run_frame_clamps_rather_than_raising(self):
        self.assertEqual(tb6612.run_frame(0, 5000), b"\x02\x00\xff")
        self.assertEqual(tb6612.run_frame(0, -5000), b"\x03\x00\xff")

    def test_zero_speed_is_forward_not_reverse(self):
        # Sign of 0 must be deterministic, or a stop flips direction at random.
        self.assertEqual(tb6612.run_frame(0, 0), b"\x02\x00\x00")

    def test_brake_stop_and_standby_frames(self):
        self.assertEqual(tb6612.brake_frame(tb6612.CH_A), b"\x00\x00")
        self.assertEqual(tb6612.stop_frame(tb6612.CH_B), b"\x01\x01")
        self.assertEqual(tb6612.standby_frame(True), b"\x04\x00")
        self.assertEqual(tb6612.standby_frame(False), b"\x05\x00")

    def test_set_addr_frame_range_checked(self):
        self.assertEqual(tb6612.set_addr_frame(0x70), b"\x11\x70")
        for bad in (0x00, 0x80, 0xFF):
            with self.assertRaises(ValueError):
                tb6612.set_addr_frame(bad)

    def test_power_to_speed_matches_teleop_units(self):
        # The seam with teleop.arcade_mix, which emits [-1, 1].
        self.assertEqual(tb6612.power_to_speed(1.0), 255)
        self.assertEqual(tb6612.power_to_speed(-1.0), -255)
        self.assertEqual(tb6612.power_to_speed(0.0), 0)
        self.assertEqual(tb6612.power_to_speed(2.5), 255)
        left, right = teleop.arcade_mix(0.0, 1.0)
        self.assertEqual(
            (tb6612.power_to_speed(left), tb6612.power_to_speed(right)), (255, -255)
        )


class TestGroveUltrasonic(unittest.TestCase):
    def test_echo_to_distance_mm(self):
        self.assertAlmostEqual(grove_us.echo_to_distance_mm(5800), 994.7, places=1)

    def test_timeout_is_out_of_range(self):
        self.assertEqual(grove_us.echo_to_distance_mm(-1), -1)
        self.assertEqual(grove_us.echo_to_distance_mm(None), -1)


    def test_constructor_identifies_before_configuring(self):
        # A wrong address / bus / half-seated lead must not surface as a bare EIO
        # from whichever control-register write happened to go first.
        class DeadBus:
            def __init__(self):
                self.writes = []

            def readfrom_mem(self, addr, reg, n):
                raise OSError(5)  # EIO

            def writeto_mem(self, addr, reg, data):
                self.writes.append((addr, reg, data))

        bus = DeadBus()
        with self.assertRaises(OSError) as ctx:
            lsm6ds3.LSM6DS3(bus, addr=0x6B)
        msg = str(ctx.exception)
        self.assertIn("0x6b", msg.lower())
        self.assertIn("scan", msg)
        # and it must not have written anything to a bus it could not identify
        self.assertEqual(bus.writes, [])

    def test_constructor_rejects_the_wrong_chip_by_name(self):
        class OtherChip:
            def readfrom_mem(self, addr, reg, n):
                return bytes([0x12])

            def writeto_mem(self, addr, reg, data):
                raise AssertionError("must not configure an unidentified device")

        with self.assertRaises(RuntimeError) as ctx:
            lsm6ds3.LSM6DS3(OtherChip(), addr=0x6B)
        self.assertIn("0x12", str(ctx.exception))

    def test_constructor_configures_a_real_lsm6ds3(self):
        class RealChip:
            def __init__(self):
                self.writes = []

            def readfrom_mem(self, addr, reg, n):
                return bytes([0x69])  # LSM6DS3

            def writeto_mem(self, addr, reg, data):
                self.writes.append((reg, data[0]))

        chip = RealChip()
        lsm6ds3.LSM6DS3(chip, addr=0x6B)
        regs = [r for r, _ in chip.writes]
        self.assertEqual(regs, [0x12, 0x10, 0x11])  # CTRL3_C, CTRL1_XL, CTRL2_G

    def test_check_false_skips_identification(self):
        # For a register-compatible variant whose WHO_AM_I we do not know.
        class Odd:
            def __init__(self):
                self.writes = []

            def readfrom_mem(self, addr, reg, n):
                raise AssertionError("must not probe when check=False")

            def writeto_mem(self, addr, reg, data):
                self.writes.append(reg)

        chip = Odd()
        lsm6ds3.LSM6DS3(chip, addr=0x6B, check=False)
        self.assertEqual(len(chip.writes), 3)


class TestPcf8563(unittest.TestCase):
    def test_bcd_round_trip(self):
        for n in (0, 9, 10, 42, 59, 99):
            self.assertEqual(pcf8563.from_bcd(pcf8563.to_bcd(n)), n)

    def test_to_bcd_rejects_out_of_range(self):
        for bad in (-1, 100):
            with self.assertRaises(ValueError):
                pcf8563.to_bcd(bad)

    def test_decode_masks_the_status_bits_out_of_each_field(self):
        # Every field shares its byte with status/padding bits. The seconds
        # register's top bit is the VL flag -- read it unmasked and 0x53 becomes
        # 0xD3 -> ":83", a plausible-looking wrong time.
        raw = bytes([0xD3, 0x00, 0x00, 0x01, 0x00, 0x01, 0x26])
        y, mo, d, h, mi, s, wd, unset = pcf8563.decode_time(raw)
        self.assertEqual((y, mo, d, h, mi, s), (2026, 1, 1, 0, 0, 53))
        self.assertTrue(unset)

    def test_decode_reports_a_trustworthy_clock(self):
        raw = bytes([0x53, 0x30, 0x09, 0x30, 0x03, 0x07, 0x26])
        y, mo, d, h, mi, s, wd, unset = pcf8563.decode_time(raw)
        self.assertEqual((y, mo, d, h, mi, s, wd), (2026, 7, 30, 9, 30, 53, 3))
        self.assertFalse(unset)

    def test_decode_matches_grover_bringup_masks(self):
        # The hour/day/month masks Grover's b2_peripherals.py validated on real
        # hardware: 0x3F, 0x3F, 0x1F. High bits set must not leak into the value.
        raw = bytes([0x00, 0x00, 0xC0 | 0x09, 0xC0 | 0x30, 0x00, 0x80 | 0x07, 0x26])
        y, mo, d, h, mi, s, wd, _ = pcf8563.decode_time(raw)
        self.assertEqual((h, d, mo), (9, 30, 7))

    def test_encode_round_trips_through_decode(self):
        enc = pcf8563.encode_time(2026, 7, 30, 9, 30, 53, 3)
        self.assertEqual(len(enc), 7)
        y, mo, d, h, mi, s, wd, unset = pcf8563.decode_time(enc)
        self.assertEqual((y, mo, d, h, mi, s, wd), (2026, 7, 30, 9, 30, 53, 3))
        # Setting the time must CLEAR the voltage-low flag -- otherwise a freshly
        # set clock still reports itself as untrustworthy forever.
        self.assertFalse(unset)

    def test_decode_rejects_a_short_read(self):
        with self.assertRaises(ValueError):
            pcf8563.decode_time(bytes([0, 0, 0]))


if __name__ == "__main__":
    unittest.main()
