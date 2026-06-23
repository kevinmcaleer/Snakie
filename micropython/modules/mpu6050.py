# SPDX-License-Identifier: MIT
"""MPU-6050 6-axis IMU driver (Snakie module #120).

A small, self-contained MIT-licensed register driver for the InvenSense MPU-6050
(3-axis accelerometer + 3-axis gyroscope over I²C). This is the driver behind the
dock **IMU** instrument (#111).

Usage on a board::

    from machine import I2C, Pin
    from mpu6050 import MPU6050
    import instruments as inst

    imu = MPU6050(I2C(0, sda=Pin(0), scl=Pin(1)))
    while True:
        ax, ay, az = imu.accel()
        inst.imu(*imu.euler_estimate())   # -> IMU instrument

The raw register decode (`raw_to_g`, `raw_to_dps`) and the accel→euler estimate
(`accel_to_euler`) are split out so they can be unit-tested under CPython without
an I²C bus.
"""

import math

# Register map (subset needed for accel + gyro).
_PWR_MGMT_1 = 0x6B
_ACCEL_XOUT_H = 0x3B
_DEFAULT_ADDR = 0x68

# Full-scale defaults after reset: accel ±2 g, gyro ±250 °/s.
_ACCEL_LSB_PER_G = 16384.0
_GYRO_LSB_PER_DPS = 131.0


def _twos16(hi, lo):
    """Combine two bytes (big-endian) into a signed 16-bit int. Pure."""
    val = (hi << 8) | lo
    return val - 65536 if val >= 32768 else val


def raw_to_g(hi, lo, lsb_per_g=_ACCEL_LSB_PER_G):
    """Decode an accelerometer axis (two raw bytes) to g. Pure."""
    return _twos16(hi, lo) / lsb_per_g


def raw_to_dps(hi, lo, lsb_per_dps=_GYRO_LSB_PER_DPS):
    """Decode a gyroscope axis (two raw bytes) to degrees/second. Pure."""
    return _twos16(hi, lo) / lsb_per_dps


def accel_to_euler(ax, ay, az):
    """Estimate (roll, pitch) in degrees from an accelerometer vector (g).

    Yaw is unobservable from gravity alone, so it is returned as ``0.0``. Pure —
    feeds the dock IMU instrument's 3-D attitude view without a gyro fusion step.
    """
    roll = math.degrees(math.atan2(ay, az)) if (ay or az) else 0.0
    pitch = math.degrees(math.atan2(-ax, math.sqrt(ay * ay + az * az)))
    return roll, pitch, 0.0


class MPU6050:
    """Driver for an MPU-6050 IMU on an I²C bus."""

    def __init__(self, i2c, addr=_DEFAULT_ADDR):
        self._i2c = i2c
        self._addr = addr
        # Wake the device (clear the SLEEP bit it powers up with).
        self._i2c.writeto_mem(addr, _PWR_MGMT_1, b"\x00")

    def _read_accel_block(self):
        # 6 bytes: ax_h, ax_l, ay_h, ay_l, az_h, az_l.
        return self._i2c.readfrom_mem(self._addr, _ACCEL_XOUT_H, 6)

    def accel(self):
        """Return the (x, y, z) acceleration in g."""
        b = self._read_accel_block()
        return raw_to_g(b[0], b[1]), raw_to_g(b[2], b[3]), raw_to_g(b[4], b[5])

    def euler_estimate(self):
        """Return an accel-only (roll, pitch, yaw=0) attitude estimate in degrees."""
        return accel_to_euler(*self.accel())
