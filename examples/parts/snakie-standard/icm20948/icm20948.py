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
_I2C_MST_STATUS = 0x17    # bit6 (0x40) = SLV4 single-transaction done
_ACCEL_XOUT_H = 0x2D      # ax,ay,az,gx,gy,gz — 12 bytes, big-endian
_GYRO_XOUT_H = 0x33
_EXT_SLV_SENS_DATA_00 = 0x3B
# USER_CTRL / INT_PIN_CFG / I2C_MST_STATUS bit masks.
_USER_CTRL_I2C_MST_EN = 0x20
_USER_CTRL_I2C_MST_RST = 0x02
_INT_PIN_CFG_BYPASS_EN = 0x02
_MST_STATUS_SLV4_DONE = 0x40

# --- Bank 2 (accel + gyro configuration) ------------------------------------
_GYRO_SMPLRT_DIV = 0x00
_GYRO_CONFIG_1 = 0x01
_ACCEL_SMPLRT_DIV_1 = 0x10
_ACCEL_SMPLRT_DIV_2 = 0x11
_ACCEL_CONFIG = 0x14

# --- Bank 3 (aux-I2C master → AK09916). SLV0 streams the measurement registers
# continuously into EXT_SLV_SENS_DATA; SLV4 does one-off AK09916 config reads/
# writes, polled via I2C_MST_STATUS — the robust Adafruit/SparkFun scheme.
_I2C_MST_CTRL = 0x01
_I2C_SLV0_ADDR = 0x03
_I2C_SLV0_REG = 0x04
_I2C_SLV0_CTRL = 0x05
_I2C_SLV4_ADDR = 0x13
_I2C_SLV4_REG = 0x14
_I2C_SLV4_CTRL = 0x15
_I2C_SLV4_DO = 0x16
_I2C_SLV4_DI = 0x17

# --- AK09916 magnetometer (on the aux bus at 0x0C) --------------------------
_AK09916_ADDR = 0x0C
_AK09916_CHIP_ID = 0x09
_AK09916_WIA = 0x01           # WHO_AM_I (device id)
_AK09916_HXL = 0x11           # measurement data start (X/Y/Z, 6 bytes LE)
_AK09916_CNTL2 = 0x31         # measurement-mode register
_AK09916_MODE_SHUTDOWN = 0x00
_AK09916_MODE_100HZ = 0x08    # continuous measurement, 100 Hz
_AK09916_UT_PER_LSB = 0.15    # µT per least-significant-bit

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

    # --- magnetometer (AK09916 via the ICM-20948's aux-I2C master) ----------
    # Robust Adafruit/SparkFun scheme: SLV4 does single AK09916 register reads/
    # writes (config), each polled to completion via I2C_MST_STATUS; SLV0 then
    # streams the measurement registers continuously into the ICM's own
    # EXT_SLV_SENS_DATA regs, so read_mag() is just a local register read — no
    # per-read trigger, and a stuck aux-master is recovered by a reset + retry.
    def _mst_wait(self):
        """Wait for the SLV4 single transaction to finish. True if it completed."""
        self._bank_select(0)
        for _ in range(100):
            if self._read(_I2C_MST_STATUS) & _MST_STATUS_SLV4_DONE:
                return True
            time.sleep_ms(10)
        return False

    def _reset_i2c_master(self):
        """Pulse USER_CTRL.I2C_MST_RST to unstick a hung aux-I2C master."""
        self._bank_select(0)
        self._write(_USER_CTRL, self._read(_USER_CTRL) | _USER_CTRL_I2C_MST_RST)
        time.sleep_ms(10)

    def _mag_read(self, reg):
        """Read one AK09916 register via SLV4 (None if it never completes)."""
        self._bank_select(3)
        self._write(_I2C_SLV4_ADDR, _AK09916_ADDR | 0x80)   # read direction
        self._write(_I2C_SLV4_REG, reg)
        self._write(_I2C_SLV4_CTRL, 0x80)                   # enable, 1 byte
        if not self._mst_wait():
            return None
        self._bank_select(3)
        return self._read(_I2C_SLV4_DI)

    def _mag_write(self, reg, value):
        """Write one AK09916 register via SLV4."""
        self._bank_select(3)
        self._write(_I2C_SLV4_ADDR, _AK09916_ADDR)          # write direction
        self._write(_I2C_SLV4_REG, reg)
        self._write(_I2C_SLV4_DO, value)
        self._write(_I2C_SLV4_CTRL, 0x80)                   # enable
        self._mst_wait()

    def _mag_init(self):
        # Enable the ICM's aux-I2C master (no bypass), ~345 kHz, no repeated start.
        self._bank_select(0)
        self._write(_INT_PIN_CFG, self._read(_INT_PIN_CFG) & ~_INT_PIN_CFG_BYPASS_EN)
        time.sleep_ms(5)
        self._bank_select(3)
        self._write(_I2C_MST_CTRL, 0x17)
        self._bank_select(0)
        self._write(_USER_CTRL, self._read(_USER_CTRL) | _USER_CTRL_I2C_MST_EN)
        time.sleep_ms(20)
        # Confirm the AK09916, retrying with a master reset if the aux bus is stuck.
        for _ in range(5):
            if self._mag_read(_AK09916_WIA) == _AK09916_CHIP_ID:
                break
            self._reset_i2c_master()
        else:
            raise RuntimeError("AK09916 magnetometer not found on aux bus")
        # 100 Hz continuous (power-down first, per the datasheet).
        self._mag_write(_AK09916_CNTL2, _AK09916_MODE_SHUTDOWN)
        time.sleep_ms(1)
        self._mag_write(_AK09916_CNTL2, _AK09916_MODE_100HZ)
        # Stream 9 bytes (HXL..ST2) from the AK09916 into EXT_SLV_SENS_DATA via
        # SLV0, so the mag data refreshes in the ICM's registers automatically.
        self._bank_select(3)
        self._write(_I2C_SLV0_ADDR, _AK09916_ADDR | 0x80)   # read direction
        self._write(_I2C_SLV0_REG, _AK09916_HXL)
        self._write(_I2C_SLV0_CTRL, 0x80 | 0x09)            # enable, 9 bytes
        self._bank_select(0)
        time.sleep_ms(50)

    def read_mag(self):
        """Return the 3-axis magnetic field as (x, y, z) in microtesla (µT), read
        from the continuously-streamed AK09916 data. Raises if the magnetometer
        wasn't found at start-up (`mag_supported` is False)."""
        if not self._mag_ok:
            raise RuntimeError("Magnetometer unavailable (AK09916 not initialised)")
        self._bank_select(0)
        mx, my, mz = struct.unpack("<hhh", self._read_bytes(_EXT_SLV_SENS_DATA_00, 6))
        s = _AK09916_UT_PER_LSB
        return (mx * s, my * s, mz * s)
