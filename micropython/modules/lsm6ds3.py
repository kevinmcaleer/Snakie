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

Mounting
--------
The tilt maths assumes the module lies flat with **Z up**. A chassis rarely
allows that, and a module on its edge reports gravity on Y — which shows up as a
permanent ~90 deg roll and sends rotations to the wrong axis. Pass ``axes`` to
say how it is mounted:

    imu = LSM6DS3(i2c, addr=0x6B, axes=('x', 'z', '-y'))   # module on its edge

`axes_for_resting(imu.accel())` works the map out for you from one reading of a
stationary board.

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


# --- Axis mapping (mounting orientation) -------------------------------------
# A sensor is almost never mounted the way a driver assumes. The tilt maths here
# takes Z as "up", but a chassis usually dictates the orientation, and a module
# stood on its edge reports gravity on Y — which reads as a permanent ~90 deg roll
# and sends every rotation to the wrong axis of the display.
#
# Rather than make every sketch re-derive it, the driver remaps ONCE at the source
# so `accel`, `gyro` and `euler_estimate` are all in the board's frame.

_AXIS_NAMES = ("x", "y", "z")


def parse_axes(spec):
    """Parse an axis map into ``[(source_index, sign), ...]`` for output X, Y, Z.

    `spec` names which SENSOR axis supplies each output axis, optionally negated:
    ``('x', 'z', '-y')`` means output Z is the negated sensor Y. Accepts a string
    (``"x z -y"`` or ``"x,z,-y"``) or any 3-sequence. ``None`` means no remapping.

    Raises `ValueError` on anything that isn't a clean right-handed map — see
    :func:`axes_determinant` for why a mirrored one is refused rather than used.
    """
    if spec is None:
        return None
    parts = spec.replace(",", " ").split() if isinstance(spec, str) else list(spec)
    if len(parts) != 3:
        raise ValueError("axes needs three entries, e.g. ('x','z','-y')")
    out = []
    for p in parts:
        p = str(p).strip().lower()
        sign = 1
        if p[:1] == "-":
            sign, p = -1, p[1:]
        elif p[:1] == "+":
            p = p[1:]
        if p not in _AXIS_NAMES:
            raise ValueError("axis %r is not one of x/y/z" % (p,))
        out.append((_AXIS_NAMES.index(p), sign))
    if len(set(i for i, _ in out)) != 3:
        raise ValueError("axes must use x, y and z exactly once (got %r)" % (spec,))
    if axes_determinant(out) != 1:
        raise ValueError(
            "axes %r is mirrored (left-handed) — negate one entry. A mirrored map "
            "reads plausibly at rest and then turns every rotation the wrong way, "
            "which is far harder to spot than an error here." % (spec,)
        )
    return out


def axes_determinant(mapped):
    """Determinant of a parsed axis map: ``+1`` right-handed, ``-1`` mirrored. Pure.

    Worth checking explicitly. A left-handed map still puts gravity where you want
    it, so it looks correct on a stationary board — but it inverts the SENSE of
    rotation, so roll runs backwards and no amount of staring at a resting reading
    reveals it.
    """
    m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for row, (i, sign) in enumerate(mapped):
        m[row][i] = sign
    return (
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    )


def apply_axes(mapped, v):
    """Apply a parsed axis map to an ``(x, y, z)`` reading. Pure; `None` = identity."""
    if not mapped:
        return v
    return tuple(v[i] * sign for i, sign in mapped)


def axes_for_resting(reading):
    """Suggest an axis map from ONE accelerometer sample of a board sitting still.

    Hold the board the way it will be mounted, take a reading, and this returns the
    `axes` that puts gravity back on +Z where the tilt maths expects it — turning
    "work out your axis map" into one call.

    Only the vertical axis is determined by gravity: any rotation ABOUT vertical
    leaves the reading identical, which is the same reason yaw is unobservable
    without a magnetometer. So of the several valid answers this returns the one
    that disturbs X and Y least, and it is a starting point, not a survey.

    A wrong guess at that quarter-turn is what "roll and pitch are swapped" looks
    like — tilting the nose up reads as roll. Use :func:`axes_from_two` to settle
    it rather than trying the other three by hand.

    Pass a reading from :meth:`LSM6DS3.raw_accel` (or a driver with no `axes` set):
    an already-mapped reading yields a map relative to the one in force.
    """
    d, up_sign = _dominant(reading)
    rest = [i for i in range(3) if i != d]
    for sign in (1, -1):
        cand = [(rest[0], 1), (rest[1], sign), (d, up_sign)]
        if axes_determinant(cand) == 1:
            return tuple(
                ("-" if s < 0 else "") + _AXIS_NAMES[i] for i, s in cand
            )
    raise ValueError("could not build a right-handed map from %r" % (reading,))


#: Cross product of two signed unit basis vectors: ``(a, b) -> (index, sign)``.
_CROSS = {
    (0, 1): (2, 1), (1, 2): (0, 1), (2, 0): (1, 1),
    (1, 0): (2, -1), (2, 1): (0, -1), (0, 2): (1, -1),
}


def axes_from_two(level, nose_down):
    """The full axis map from TWO resting readings — the complete calibration.

    Gravity gives you the vertical direction and nothing else. That fixes roll and
    pitch, but leaves the rotation ABOUT vertical free, which is precisely the
    ambiguity :func:`axes_for_resting` has to guess at: get it wrong by 90 deg and
    tilting the nose up still shows as roll. A second pose collapses it.

      1. `level`     — the board sitting as it is mounted, still.
      2. `nose_down` — the same board with its FORWARD direction pointing at the
         floor.

    In pose 2 gravity lies along the robot's forward axis, so it names that axis
    the way pose 1 names the vertical one. Between them the frame is fully
    determined, and the third axis follows from the right-hand rule rather than
    from another measurement.

    Returns an `axes` tuple for the constructor. Raises `ValueError` if the two
    poses aren't distinct enough to be telling us different things.

    Both readings must come from :meth:`LSM6DS3.raw_accel` (or a driver with no
    `axes` set) — an already-mapped reading derives a map relative to the one in
    force, which looks like it worked and is wrong by exactly the correction
    already applied.
    """
    iz, sz = _dominant(level)
    ix, sx = _dominant(nose_down)
    # Pose 2 has the nose pointing DOWN, so the axis reading +1g there is the
    # nose's opposite.
    sx = -sx
    if iz == ix:
        raise ValueError(
            "both readings put gravity on the same axis — pose 2 should have the "
            "board's FORWARD direction pointing at the floor, about 90 deg from pose 1"
        )
    iy, cross_sign = _CROSS[(iz, ix)]
    sy = sz * sx * cross_sign
    out = [(ix, sx), (iy, sy), (iz, sz)]
    return tuple(("-" if s < 0 else "") + _AXIS_NAMES[i] for i, s in out)


def _dominant(reading):
    """``(index, sign)`` of the axis carrying gravity in a resting reading. Pure."""
    mags = (abs(reading[0]), abs(reading[1]), abs(reading[2]))
    d = mags.index(max(mags))
    return d, (-1 if reading[d] < 0 else 1)


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

    `axes` describes how the module is MOUNTED — see :func:`parse_axes`. Leave it
    out for a board lying flat with its component face up; set it once when the
    chassis dictates otherwise, and every reading arrives in the board's frame.
    """

    def __init__(
        self, i2c, addr=_DEFAULT_ADDR, odr_hz=104, g_range=2, dps_range=245, check=True, axes=None
    ):
        self._i2c = i2c
        self._addr = addr
        self._g_range = g_range
        self._dps_range = dps_range
        # Mounting orientation. Validated HERE, at construction, so a bad map is a
        # clear error at the line that set it rather than silently wrong readings
        # for the life of the program.
        self._axes = parse_axes(axes)
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
        """Return the (x, y, z) acceleration in g, in the BOARD's frame."""
        return apply_axes(self._axes, self.raw_accel())

    def raw_accel(self):
        """Acceleration in the SENSOR's own frame, ignoring any `axes` map.

        What the calibration helpers need. Feeding them :meth:`accel` from a driver
        that ALREADY has a map would derive a map relative to that one — it would
        look like it worked and be wrong by exactly the correction already applied.
        """
        b = self._i2c.readfrom_mem(self._addr, _OUTX_L_XL, 6)
        r = self._g_range
        return (
            raw_to_g(b[0], b[1], r),
            raw_to_g(b[2], b[3], r),
            raw_to_g(b[4], b[5], r),
        )

    def gyro(self):
        """Return the (x, y, z) angular rate in degrees/second, in the BOARD's frame.

        Remapped with the same `axes` as :meth:`accel` — they MUST agree, or a
        fusion step would be blending two different coordinate frames.
        """
        b = self._i2c.readfrom_mem(self._addr, _OUTX_L_G, 6)
        r = self._dps_range
        return apply_axes(
            self._axes,
            (
                raw_to_dps(b[0], b[1], r),
                raw_to_dps(b[2], b[3], r),
                raw_to_dps(b[4], b[5], r),
            ),
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
