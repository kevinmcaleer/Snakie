"""Pure-MicroPython driver for the TDK InvenSense ICM-20948 9-DoF IMU.

The ICM-20948 is a 3-axis accelerometer + 3-axis gyroscope in one die, plus an
AK09916 3-axis magnetometer on an internal auxiliary I2C bus. Its registers are
paged into four *user banks* selected through REG_BANK_SEL (0x7F); this driver
switches banks for you. Register addresses follow the ICM-20948 datasheet
(DS-000189) register map and the AK09916 datasheet.

    from machine import I2C, Pin
    from icm20948 import ICM20948

    i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400_000)
    imu = ICM20948(i2c)            # addr=0x69 if you cut the address trace
    ax, ay, az = imu.read_accel()  # g
    gx, gy, gz = imu.read_gyro()   # degrees / second
    mx, my, mz = imu.read_mag()    # microtesla

The magnetometer is read through the ICM-20948's I2C-master pass-through (the
AK09916 hangs off the aux bus at 0x0C); `read_mag()` triggers a single-shot
measurement and waits for the data-ready flag. If the AK09916 can't be reached
at start-up, accel + gyro still work and `read_mag()` raises. Self-contained:
only `machine` (passed in), `time` and `ustruct`. No side effects on import.
"""

try:
    import ustruct as struct
except ImportError:  # CPython fallback so the file is import-safe off-device
    import struct

import time

# --- ICM-20948 identity -----------------------------------------------------
_CHIP_ID = 0xEA           # WHO_AM_I value
_REG_BANK_SEL = 0x7F      # bank select (reachable from every bank)

# --- Bank 0 -----------------------------------------------------------------
_WHO_AM_I = 0x00
_USER_CTRL = 0x03
_PWR_MGMT_1 = 0x06
_PWR_MGMT_2 = 0x07
_INT_PIN_CFG = 0x0F
_ACCEL_XOUT_H = 0x2D      # ax,ay,az,gx,gy,gz — 12 bytes, big-endian
_GYRO_XOUT_H = 0x33
_EXT_SLV_SENS_DATA_00 = 0x3B

# --- Bank 2 (accel + gyro configuration) ------------------------------------
_GYRO_CONFIG_1 = 0x01
_ACCEL_CONFIG = 0x14

# --- Bank 3 (I2C master → AK09916) ------------------------------------------
_I2C_MST_CTRL = 0x01
_I2C_MST_DELAY_CTRL = 0x02
_I2C_SLV0_ADDR = 0x03
_I2C_SLV0_REG = 0x04
_I2C_SLV0_CTRL = 0x05
_I2C_SLV0_DO = 0x06

# --- AK09916 magnetometer (on the aux bus at 0x0C) --------------------------
_AK09916_ADDR = 0x0C
_AK09916_CHIP_ID = 0x09
_AK09916_WIA = 0x01       # WHO_AM_I
_AK09916_ST1 = 0x10       # bit0 = data ready
_AK09916_HXL = 0x11       # measurement start (6 bytes, little-endian)
_AK09916_CNTL2 = 0x31     # 0x01 = single measurement
_AK09916_CNTL3 = 0x32     # 0x01 = soft reset
_AK09916_UT_PER_LSB = 0.15  # µT per least-significant-bit

_ACCEL_GS = {2: 16384.0, 4: 8192.0, 8: 4096.0, 16: 2048.0}
_GYRO_DPS = {250: 131.0, 500: 65.5, 1000: 32.8, 2000: 16.4}


class ICM20948:
    """ICM-20948 9-DoF IMU on an existing `machine.I2C` bus."""

    def __init__(self, i2c, addr=0x68):
        self.i2c = i2c
        self.addr = addr
        self._bank = -1
        self._accel_gs = _ACCEL_GS[16]
        self._gyro_dps = _GYRO_DPS[250]
        self._mag_ok = False

        self._bank_select(0)
        if self._read(_WHO_AM_I) != _CHIP_ID:
            raise RuntimeError("ICM20948 not found (bad WHO_AM_I) at 0x%02x" % addr)

        # Reset, wait, then wake with the best available clock; enable all axes.
        self._write(_PWR_MGMT_1, 0x80)
        time.sleep_ms(10)
        self._write(_PWR_MGMT_1, 0x01)
        self._write(_PWR_MGMT_2, 0x00)
        time.sleep_ms(10)

        self.set_gyro_full_scale(250)
        self.set_accel_full_scale(16)

        # Best-effort magnetometer bring-up; accel + gyro still work if it fails.
        try:
            self._mag_init()
            self._mag_ok = True
        except Exception:  # noqa: BLE001 — degrade gracefully to 6-DoF
            self._mag_ok = False

    # --- low-level I2C ------------------------------------------------------
    def _write(self, reg, value):
        self.i2c.writeto_mem(self.addr, reg, bytes([value & 0xFF]))

    def _read(self, reg):
        return self.i2c.readfrom_mem(self.addr, reg, 1)[0]

    def _read_bytes(self, reg, length):
        return self.i2c.readfrom_mem(self.addr, reg, length)

    def _bank_select(self, bank):
        """Switch the active user bank (cached to skip redundant writes)."""
        if self._bank != bank:
            self.i2c.writeto_mem(self.addr, _REG_BANK_SEL, bytes([bank << 4]))
            self._bank = bank

    # --- identity -----------------------------------------------------------
    def who_am_i(self):
        """Return the WHO_AM_I byte (0xEA on a healthy ICM-20948)."""
        self._bank_select(0)
        return self._read(_WHO_AM_I)

    @property
    def mag_supported(self):
        """True when the AK09916 magnetometer was found at start-up."""
        return self._mag_ok

    # --- configuration ------------------------------------------------------
    def set_accel_full_scale(self, g=16):
        """Set the accelerometer range to ±`g` (one of 2, 4, 8, 16)."""
        self._bank_select(2)
        value = (self._read(_ACCEL_CONFIG) & 0b11111001) | ({2: 0, 4: 1, 8: 2, 16: 3}[g] << 1)
        self._write(_ACCEL_CONFIG, value)
        self._accel_gs = _ACCEL_GS[g]

    def set_gyro_full_scale(self, dps=250):
        """Set the gyro range to ±`dps` (one of 250, 500, 1000, 2000)."""
        self._bank_select(2)
        value = (self._read(_GYRO_CONFIG_1) & 0b11111001) | ({250: 0, 500: 1, 1000: 2, 2000: 3}[dps] << 1)
        self._write(_GYRO_CONFIG_1, value)
        self._gyro_dps = _GYRO_DPS[dps]

    # --- accel + gyro -------------------------------------------------------
    def read_accel_gyro(self):
        """Read accel (g) and gyro (dps) together: (ax, ay, az, gx, gy, gz)."""
        self._bank_select(0)
        ax, ay, az, gx, gy, gz = struct.unpack(">hhhhhh", self._read_bytes(_ACCEL_XOUT_H, 12))
        gs, dps = self._accel_gs, self._gyro_dps
        return (ax / gs, ay / gs, az / gs, gx / dps, gy / dps, gz / dps)

    def read_accel(self):
        """Return the 3-axis acceleration as (x, y, z) in g."""
        self._bank_select(0)
        ax, ay, az = struct.unpack(">hhh", self._read_bytes(_ACCEL_XOUT_H, 6))
        gs = self._accel_gs
        return (ax / gs, ay / gs, az / gs)

    def read_gyro(self):
        """Return the 3-axis angular rate as (x, y, z) in degrees/second."""
        self._bank_select(0)
        gx, gy, gz = struct.unpack(">hhh", self._read_bytes(_GYRO_XOUT_H, 6))
        dps = self._gyro_dps
        return (gx / dps, gy / dps, gz / dps)

    # --- magnetometer (via the ICM-20948 I2C master) ------------------------
    def _trigger_mag_io(self):
        """Pulse the I2C-master enable so a queued SLV0 transaction runs."""
        self._bank_select(0)
        user = self._read(_USER_CTRL)
        self._write(_USER_CTRL, user | 0x20)
        time.sleep_ms(5)
        self._write(_USER_CTRL, user)

    def _mag_write(self, reg, value):
        self._bank_select(3)
        self._write(_I2C_SLV0_ADDR, _AK09916_ADDR)          # write direction
        self._write(_I2C_SLV0_REG, reg)
        self._write(_I2C_SLV0_DO, value)
        self._bank_select(0)
        self._trigger_mag_io()

    def _mag_read(self, reg):
        self._bank_select(3)
        self._write(_I2C_SLV0_ADDR, _AK09916_ADDR | 0x80)   # read direction
        self._write(_I2C_SLV0_REG, reg)
        self._write(_I2C_SLV0_DO, 0xFF)
        self._write(_I2C_SLV0_CTRL, 0x80 | 1)               # enable, 1 byte
        self._bank_select(0)
        self._trigger_mag_io()
        return self._read(_EXT_SLV_SENS_DATA_00)

    def _mag_read_bytes(self, reg, length):
        self._bank_select(3)
        self._write(_I2C_SLV0_CTRL, 0x80 | 0x08 | length)   # enable, byte-swap, N
        self._write(_I2C_SLV0_ADDR, _AK09916_ADDR | 0x80)
        self._write(_I2C_SLV0_REG, reg)
        self._write(_I2C_SLV0_DO, 0xFF)
        self._bank_select(0)
        self._trigger_mag_io()
        return self._read_bytes(_EXT_SLV_SENS_DATA_00, length)

    def _mag_init(self):
        # Route the aux bus to the on-die master and clock it.
        self._bank_select(0)
        self._write(_INT_PIN_CFG, 0x30)
        self._bank_select(3)
        self._write(_I2C_MST_CTRL, 0x4D)
        self._write(_I2C_MST_DELAY_CTRL, 0x01)
        self._bank_select(0)
        if self._mag_read(_AK09916_WIA) != _AK09916_CHIP_ID:
            raise RuntimeError("AK09916 magnetometer not found on aux bus")
        # Soft-reset the magnetometer and wait for it to clear.
        self._mag_write(_AK09916_CNTL3, 0x01)
        start = time.ticks_ms()
        while self._mag_read(_AK09916_CNTL3) == 0x01:
            if time.ticks_diff(time.ticks_ms(), start) > 100:
                break
            time.sleep_ms(1)

    def read_mag(self, timeout_ms=1000):
        """Return the 3-axis magnetic field as (x, y, z) in microtesla (µT).

        Triggers a single AK09916 measurement and waits for data-ready. Raises
        RuntimeError if the magnetometer wasn't found or times out.
        """
        if not self._mag_ok:
            raise RuntimeError("Magnetometer unavailable (AK09916 not initialised)")
        self._mag_write(_AK09916_CNTL2, 0x01)  # single measurement
        start = time.ticks_ms()
        while not (self._mag_read(_AK09916_ST1) & 0x01):
            if time.ticks_diff(time.ticks_ms(), start) > timeout_ms:
                raise RuntimeError("Timeout waiting for magnetometer data")
            time.sleep_ms(1)
        mx, my, mz = struct.unpack("<hhh", self._mag_read_bytes(_AK09916_HXL, 6))
        s = _AK09916_UT_PER_LSB
        return (mx * s, my * s, mz * s)
