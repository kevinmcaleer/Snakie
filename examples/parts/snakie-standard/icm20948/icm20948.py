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
_CHIP_ID = 0xEA           # WHO_AM_I value (genuine ICM-20948)
# WHO_AM_I bytes we accept: 0xEA is the ICM-20948; 0xE0/0xE1 are the register-
# compatible ICM-20648 / ICM-20649.
_KNOWN_IDS = (0xEA, 0xE1, 0xE0)
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
_GYRO_SMPLRT_DIV = 0x00
_GYRO_CONFIG_1 = 0x01
_ACCEL_SMPLRT_DIV_1 = 0x10
_ACCEL_SMPLRT_DIV_2 = 0x11
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
        self._accel_gs = _ACCEL_GS[16]
        self._gyro_dps = _GYRO_DPS[250]
        self._mag_ok = False

        # The ICM-20948's AD0 pin / the breakout's address trace selects 0x68 or
        # 0x69. Probe `addr` first, then the alternate, so the driver works however
        # the board is strapped — instead of an opaque EIO on the wrong address.
        self.addr = self._probe_addr(addr)

        # Reset, wait, then wake with the best available clock; enable all axes.
        self._write(_PWR_MGMT_1, 0x80)
        time.sleep_ms(10)
        self._write(_PWR_MGMT_1, 0x01)
        self._write(_PWR_MGMT_2, 0x00)
        time.sleep_ms(10)

        # Configure gyro + accel exactly as the Pimoroni driver does: sample rate,
        # then low-pass filter (mode 5), then full-scale range.
        self.set_gyro_sample_rate(100)
        self.set_gyro_low_pass(enabled=True, mode=5)
        self.set_gyro_full_scale(250)
        self.set_accel_sample_rate(125)
        self.set_accel_low_pass(enabled=True, mode=5)
        self.set_accel_full_scale(16)

        # Best-effort magnetometer bring-up; accel + gyro still work if it fails.
        try:
            self._mag_init()
            self._mag_ok = True
        except Exception:  # noqa: BLE001 — degrade gracefully to 6-DoF
            self._mag_ok = False

    # --- address discovery --------------------------------------------------
    def _read_whoami(self):
        """Read WHO_AM_I as two STOP-separated transactions (write the register
        pointer, then read) rather than readfrom_mem's repeated-START — the
        repeated-START is the phase most likely to glitch on a loaded / weak-
        pull-up bus."""
        self.i2c.writeto(self.addr, bytes([_WHO_AM_I]))
        return self.i2c.readfrom(self.addr, 1)[0]

    def _probe_addr(self, preferred):
        """Find the ICM-20948 (0x68/0x69), trying `preferred` first, with a robust
        identity read; on failure raise a SPECIFIC error so a wiring fault, a
        wrong chip and an absent chip are told apart:
          * an address that ACKs (is in i2c.scan()) but whose transfers all EIO
            -> a BUS/wiring fault (bad pull-ups, loose SDA/SCL/GND);
          * an address that reads but reports a foreign WHO_AM_I -> wrong chip;
          * nothing on the bus at 0x68/0x69 -> not connected.
        """
        try:
            present = set(self.i2c.scan())
        except Exception:  # noqa: BLE001 — scan unsupported; probe blindly
            present = None

        transfer_fault = []   # ACKs its address but reads/writes EIO
        wrong_chip = []       # reads OK but WHO_AM_I isn't an InvenSense IMU
        for a in [preferred] + [x for x in (0x68, 0x69) if x != preferred]:
            if present is not None and a not in present:
                continue
            self.addr = a
            got = None
            for _ in range(4):
                try:
                    self._bank = -1  # force a fresh bank-select each attempt
                    self._bank_select(0)
                    time.sleep_ms(1)  # let the bank write settle before reading
                    got = self._read_whoami()
                except OSError:
                    got = None
                    # Best-effort: clear a possible dirty state (aux-I2C master
                    # left running by a prior soft-reboot) before retrying.
                    try:
                        self.i2c.writeto_mem(a, _PWR_MGMT_1, b"\x80")
                        time.sleep_ms(10)
                    except OSError:
                        pass
                    time.sleep_ms(5)
                    continue
                if got in _KNOWN_IDS:
                    self._bank = 0  # after a settle the chip is in bank 0
                    return a
                time.sleep_ms(5)
            (transfer_fault if got is None else wrong_chip).append(
                a if got is None else (a, got)
            )

        if transfer_fault:
            raise OSError(
                "0x%02X ACKs its address but every I2C transfer fails (EIO). "
                "This is a BUS/wiring fault, not the driver: check the SDA/SCL "
                "pull-ups (4.7k to 3V3), a solid common GND, and re-seat SDA/SCL. "
                "A phantom address like 0x08 in i2c.scan() confirms a noisy bus."
                % transfer_fault[0]
            )
        if wrong_chip:
            a, got = wrong_chip[0]
            raise OSError(
                "0x%02X reports WHO_AM_I=0x%02X, not an ICM-20948 (0xEA). "
                "0x71/0x70/0x68 (at reg 0x75) = MPU-9250/6500/6050; "
                "0xFF/0x00 = a bus glitch." % (a, got)
            )
        raise OSError(
            "ICM20948 not found at 0x68/0x69 — check wiring (SDA/SCL/3V3/GND) "
            "and run i2c.scan() to see what's on the bus"
        )

    # --- low-level I2C ------------------------------------------------------
    def _write(self, reg, value):
        self.i2c.writeto_mem(self.addr, reg, bytes([value & 0xFF]))
        time.sleep_us(100)  # match Pimoroni: let the register write settle

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

    # Sample-rate + low-pass filter config, mirroring the Pimoroni driver's init so
    # the accel/gyro are filtered/paced identically (not left at raw defaults).
    def set_gyro_sample_rate(self, rate=100):
        """Set the gyro output data rate in Hz (1.125 kHz / (1 + div))."""
        self._bank_select(2)
        self._write(_GYRO_SMPLRT_DIV, int((1125.0 / rate) - 1) & 0xFF)

    def set_gyro_low_pass(self, enabled=True, mode=5):
        """Configure the gyro digital low-pass filter (mode 0..7)."""
        self._bank_select(2)
        value = self._read(_GYRO_CONFIG_1) & 0b10001110
        if enabled:
            value |= 0b1
        value |= (mode & 0x07) << 4
        self._write(_GYRO_CONFIG_1, value)

    def set_accel_sample_rate(self, rate=125):
        """Set the accelerometer output data rate in Hz (1.125 kHz / (1 + div))."""
        self._bank_select(2)
        div = int((1125.0 / rate) - 1)
        self._write(_ACCEL_SMPLRT_DIV_1, (div >> 8) & 0xFF)
        self._write(_ACCEL_SMPLRT_DIV_2, div & 0xFF)

    def set_accel_low_pass(self, enabled=True, mode=5):
        """Configure the accelerometer digital low-pass filter (mode 0..7)."""
        self._bank_select(2)
        value = self._read(_ACCEL_CONFIG) & 0b10001110
        if enabled:
            value |= 0b1
        value |= (mode & 0x07) << 4
        self._write(_ACCEL_CONFIG, value)

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
