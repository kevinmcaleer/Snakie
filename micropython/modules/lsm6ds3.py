# SPDX-License-Identifier: MIT
"""LSM6DS3 6-axis IMU driver (Snakie module #120).

A small, self-contained MIT-licensed register driver for the ST LSM6DS3 (3-axis
accelerometer + 3-axis gyroscope over I²C) — the sensor on Seeed's **Grove 6-Axis
Accelerometer & Gyroscope**. This is a driver behind the dock **IMU** instrument
(#111), alongside the MPU-6050.

Why not the existing `lsm6ds` catalog entry: that one installs a **LSM6DSOX**
driver, a different part whose ``WHO_AM_I`` is ``0x6C``. An LSM6DS3 answers
``0x69`` and would be rejected by it.

Usage on a board::

    from machine import I2C, Pin
    from lsm6ds3 import LSM6DS3
    import instruments as inst

    # The Grove I2C port is D4/D5 on every XIAO, but the GPIO NUMBERS behind
    # those silk names differ by board:
    #     XIAO RP2040 / RP2350   sda=Pin(6),  scl=Pin(7)
    #     XIAO ESP32-S3          sda=Pin(5),  scl=Pin(6)
    imu = LSM6DS3(I2C(1, sda=Pin(5), scl=Pin(6)), addr=0x6B)   # XIAO ESP32-S3
    while True:
        ax, ay, az = imu.accel()          # g
        gx, gy, gz = imu.gyro()           # degrees/second
        inst.imu(*imu.euler_estimate())   # -> IMU instrument

Addressing
----------
The chip's own default is ``0x6A`` (SA0 low). **Seeed's Grove module ships SA0
high, so it answers on 0x6B** — pass ``addr=0x6B`` for that board. `b0_scan.py`
style bus census is the reliable way to tell.

The register decode (`raw_to_g`, `raw_to_dps`) and the config-byte builders
(`ctrl1_xl`, `ctrl2_g`) are pure, so they can be unit-tested under CPython
without an I²C bus — which is where a wrong full-scale bit pattern would
otherwise hide, silently mis-scaling every reading.
"""

import math

# --- Register map (the subset needed for accel + gyro) -----------------------
_WHO_AM_I = 0x0F
_CTRL1_XL = 0x10  # accelerometer: ODR | full-scale | anti-alias bandwidth
_CTRL2_G = 0x11  # gyroscope: ODR | full-scale
_CTRL3_C = 0x12  # BDU / IF_INC / SW_RESET
_OUT_TEMP_L = 0x20
_OUTX_L_G = 0x22  # gyro block, 6 bytes
_OUTX_L_XL = 0x28  # accel block, 6 bytes

#: Both addresses the part can take: SA0 low, SA0 high. Seeed's Grove 6-Axis
#: ships SA0 HIGH, so it answers on 0x6B rather than the chip's 0x6A default.
ADDRESSES = (0x6A, 0x6B)

_DEFAULT_ADDR = 0x6A  # SA0 low. Seeed's Grove module is 0x6B (SA0 high).

# `WHO_AM_I` answers we accept: the LSM6DS3 proper, and the LSM6DS3TR-C variant
# that is register-compatible for everything this driver touches.
WHO_AM_I_VALUES = (0x69, 0x6A)

# CTRL3_C: BDU (don't tear a sample across a read) + IF_INC (auto-increment the
# register pointer, so a 6-byte block read works).
_CTRL3_BDU = 0x40
_CTRL3_IF_INC = 0x04
_CTRL3_SW_RESET = 0x01

# --- Full-scale encodings ----------------------------------------------------
# NOTE the accelerometer's ordering: ±16 g sits at 0b01, NOT at the end. Getting
# this "obviously" sequential would silently mis-scale 4/8/16 g. Verified against
# the LSM6DS3 register map.
_FS_XL = {2: 0x00, 16: 0x04, 4: 0x08, 8: 0x0C}
_FS_G = {245: 0x00, 500: 0x04, 1000: 0x08, 2000: 0x0C}
_FS_125_BIT = 0x02  # CTRL2_G: the 125 dps range is its own enable bit

# Output data rates → the ODR nibble shared by CTRL1_XL and CTRL2_G.
_ODR = {
    0: 0x00,  # power-down
    13: 0x10,
    26: 0x20,
    52: 0x30,
    104: 0x40,
    208: 0x50,
    416: 0x60,
    833: 0x70,
    1660: 0x80,
}

# Sensitivities, in mg and mdps per LSB (datasheet; they scale with full scale).
_ACCEL_MG_PER_LSB = {2: 0.061, 4: 0.122, 8: 0.244, 16: 0.488}
_GYRO_MDPS_PER_LSB = {125: 4.375, 245: 8.75, 500: 17.5, 1000: 35.0, 2000: 70.0}


def _twos16(lo, hi):
    """Combine two bytes (LITTLE-endian, as the LSM6DS3 emits them) into a
    signed 16-bit int. Pure.

    Note the byte order differs from the MPU-6050, which is big-endian — reading
    this device with that decode gives plausible-looking nonsense.
    """
    val = (hi << 8) | lo
    return val - 65536 if val >= 32768 else val


def raw_to_g(lo, hi, g_range=2):
    """Decode an accelerometer axis (two raw bytes, low first) to g. Pure."""
    return _twos16(lo, hi) * _ACCEL_MG_PER_LSB[g_range] / 1000.0


def raw_to_dps(lo, hi, dps_range=245):
    """Decode a gyroscope axis (two raw bytes, low first) to degrees/second. Pure."""
    return _twos16(lo, hi) * _GYRO_MDPS_PER_LSB[dps_range] / 1000.0


def ctrl1_xl(odr_hz=104, g_range=2):
    """Build the CTRL1_XL byte for an accelerometer rate + full scale. Pure."""
    if odr_hz not in _ODR:
        raise ValueError("unsupported accel ODR: %r" % (odr_hz,))
    if g_range not in _FS_XL:
        raise ValueError("unsupported accel range: %r g" % (g_range,))
    return _ODR[odr_hz] | _FS_XL[g_range]


def ctrl2_g(odr_hz=104, dps_range=245):
    """Build the CTRL2_G byte for a gyroscope rate + full scale. Pure.

    ``125`` dps is not part of the FS_G field — it has its own enable bit, and
    the FS_G bits must read 0 alongside it.
    """
    if odr_hz not in _ODR:
        raise ValueError("unsupported gyro ODR: %r" % (odr_hz,))
    if dps_range == 125:
        return _ODR[odr_hz] | _FS_125_BIT
    if dps_range not in _FS_G:
        raise ValueError("unsupported gyro range: %r dps" % (dps_range,))
    return _ODR[odr_hz] | _FS_G[dps_range]


def accel_to_euler(ax, ay, az):
    """Estimate (roll, pitch) in degrees from an accelerometer vector (g).

    Yaw is unobservable from gravity alone, so it is returned as ``0.0``. Pure —
    feeds the dock IMU instrument's 3-D attitude view without a fusion step.
    """
    roll = math.degrees(math.atan2(ay, az)) if (ay or az) else 0.0
    pitch = math.degrees(math.atan2(-ax, math.sqrt(ay * ay + az * az)))
    return roll, pitch, 0.0


class LSM6DS3:
    """Driver for an LSM6DS3 6-axis IMU on an I²C bus.

    `g_range` is 2/4/8/16 (g) and `dps_range` is 125/245/500/1000/2000 — both
    also select the conversion factor, so a reading is always in real units.
    """

    def __init__(self, i2c, addr=_DEFAULT_ADDR, odr_hz=104, g_range=2, dps_range=245, check=True):
        self._i2c = i2c
        self._addr = addr
        self._g_range = g_range
        self._dps_range = dps_range
        # IDENTIFY before configuring. Blind-writing the three control registers
        # turns a wrong address, the wrong bus, or a half-seated Grove lead into a
        # bare `OSError: [Errno 5] EIO` from whichever write happened to go first,
        # which tells you nothing about which of those it was.
        #
        # Pass `check=False` to skip, e.g. for a register-compatible variant whose
        # WHO_AM_I isn't one we know.
        if check:
            try:
                who = i2c.readfrom_mem(addr, _WHO_AM_I, 1)[0]
            except OSError:
                # Before blaming the wiring, look at the OTHER address this part
                # can take. The chip's default is 0x6A (SA0 low) but Seeed's Grove
                # module ships SA0 HIGH, so `LSM6DS3(i2c)` on that board misses by
                # one address — a confusing failure with an obvious cause.
                other = ADDRESSES[1] if addr == ADDRESSES[0] else ADDRESSES[0]
                sibling = None
                try:
                    sibling = i2c.readfrom_mem(other, _WHO_AM_I, 1)[0]
                except OSError:
                    pass
                if sibling in WHO_AM_I_VALUES:
                    raise OSError(
                        "no LSM6DS3 at 0x%02x, but one answered at 0x%02x — "
                        "pass addr=0x%02x. (Seeed's Grove 6-Axis ships SA0 high.)"
                        % (addr, other, other)
                    )
                if sibling is not None:
                    # Readable but wrong: say WHAT it read. Reporting only "nothing
                    # at 0x6a" hides the far more useful fact that the other address
                    # replied with rubbish, which is a different fault entirely.
                    raise OSError(
                        "no LSM6DS3 at 0x%02x. A device at 0x%02x replied but its "
                        "WHO_AM_I is 0x%02x, not %s — 0xff means it is ACKing without "
                        "driving data, which is a power or connection fault on that "
                        "module rather than the wrong address."
                        % (addr, other, sibling, " or ".join("0x%02x" % v for v in WHO_AM_I_VALUES))
                    )
                raise OSError(
                    "no reply from an I2C device at 0x%02x. Check the bus pins and "
                    "reseat the lead, then run i2c.scan() to see what is really there. "
                    "A device that shows up in scan() but fails here is usually a "
                    "half-seated Grove connector." % addr
                )
            if who not in WHO_AM_I_VALUES:
                raise RuntimeError(
                    "the device at 0x%02x is not an LSM6DS3: WHO_AM_I read 0x%02x, "
                    "expected %s. (0xff usually means a marginal lead rather than the "
                    "wrong chip.)"
                    % (addr, who, " or ".join("0x%02x" % v for v in WHO_AM_I_VALUES))
                )
        # Block-data-update + register auto-increment, so a 6-byte burst read is
        # coherent and actually advances.
        self._i2c.writeto_mem(addr, _CTRL3_C, bytes([_CTRL3_BDU | _CTRL3_IF_INC]))
        self._i2c.writeto_mem(addr, _CTRL1_XL, bytes([ctrl1_xl(odr_hz, g_range)]))
        self._i2c.writeto_mem(addr, _CTRL2_G, bytes([ctrl2_g(odr_hz, dps_range)]))

    def whoami(self):
        """Read ``WHO_AM_I``. An LSM6DS3 answers ``0x69``."""
        return self._i2c.readfrom_mem(self._addr, _WHO_AM_I, 1)[0]

    def present(self):
        """True when the device on this address identifies as an LSM6DS3."""
        try:
            return self.whoami() in WHO_AM_I_VALUES
        except OSError:
            return False

    def accel(self):
        """Return the (x, y, z) acceleration in g."""
        b = self._i2c.readfrom_mem(self._addr, _OUTX_L_XL, 6)
        r = self._g_range
        return (
            raw_to_g(b[0], b[1], r),
            raw_to_g(b[2], b[3], r),
            raw_to_g(b[4], b[5], r),
        )

    def gyro(self):
        """Return the (x, y, z) angular rate in degrees/second."""
        b = self._i2c.readfrom_mem(self._addr, _OUTX_L_G, 6)
        r = self._dps_range
        return (
            raw_to_dps(b[0], b[1], r),
            raw_to_dps(b[2], b[3], r),
            raw_to_dps(b[4], b[5], r),
        )

    def temperature(self):
        """Return the die temperature in °C (25 °C at zero, 256 LSB/°C)."""
        b = self._i2c.readfrom_mem(self._addr, _OUT_TEMP_L, 2)
        return 25.0 + _twos16(b[0], b[1]) / 256.0

    def euler_estimate(self):
        """Return an accel-only (roll, pitch, yaw=0) attitude estimate in degrees."""
        return accel_to_euler(*self.accel())

    def reset(self):
        """Software-reset the device (it clears the bit when done)."""
        self._i2c.writeto_mem(self._addr, _CTRL3_C, bytes([_CTRL3_SW_RESET]))
