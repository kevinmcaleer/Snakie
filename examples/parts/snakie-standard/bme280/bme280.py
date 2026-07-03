"""BME280 temperature / pressure / humidity driver for MicroPython.

A pure-MicroPython I²C driver for the Bosch BME280 combined humidity, pressure
and temperature sensor (as broken out on the Pimoroni BME280 Breakout). It reads
the factory trimming (calibration) parameters and applies the Bosch compensation
formulas from the BME280 datasheet — Bosch Sensortec, document BST-BME280-DS002 —
to return calibrated readings.

    from machine import I2C, Pin
    from bme280 import BME280

    i2c = I2C(0, sda=Pin(0), scl=Pin(1))
    bme = BME280(i2c)             # Pimoroni default address 0x76 (0x77 selectable)
    temp, pressure, humidity = bme.read()   # °C, hPa, %RH
    print(temp, pressure, humidity)

Depends only on `time` and `ustruct` from MicroPython (the I²C bus object is
passed in). Importing the module has no side effects; the sensor is configured
when a BME280 instance is created.
"""

import time
import ustruct

_CHIP_ID = 0x60  # value read from the id register on a genuine BME280

# Register map (BME280 datasheet §5.3).
_REG_ID = 0xD0
_REG_RESET = 0xE0
_REG_CTRL_HUM = 0xF2
_REG_STATUS = 0xF3
_REG_CTRL_MEAS = 0xF4
_REG_CONFIG = 0xF5
_REG_DATA = 0xF7  # burst-read start: press(3) + temp(3) + hum(2) = 8 bytes
_REG_CALIB_00 = 0x88  # dig_T1..dig_H1  (0x88..0xA1)
_REG_CALIB_26 = 0xE1  # dig_H2..dig_H6  (0xE1..0xE7)


def _s12(v):
    """Sign-extend a 12-bit value (used for the packed dig_H4 / dig_H5)."""
    return v - 4096 if v & 0x800 else v


class BME280:
    """One Bosch BME280 on an I²C bus."""

    def __init__(self, i2c, addr=0x76):
        self.i2c = i2c
        self.t_fine = 0
        # Probe 0x76 then 0x77 (the ADDR strap picks one) with a chip-id read,
        # and raise a SPECIFIC error: an address that ACKs (shows in i2c.scan())
        # but whose reads fail is a BUS/wiring fault; a readable chip with a
        # foreign id is the wrong part; silence at both means not connected.
        self.addr = addr
        seen = None  # (addr, chip_id) at a readable-but-foreign address
        fault = None  # an address that ACKed but couldn't be read
        for a in [addr] + [x for x in (0x76, 0x77) if x != addr]:
            self.addr = a
            try:
                chip = self._read8(_REG_ID)
            except OSError:
                try:
                    present = a in i2c.scan()
                except Exception:
                    present = False
                if present and fault is None:
                    fault = a
                continue
            if chip == _CHIP_ID:
                break
            if seen is None:
                seen = (a, chip)
        else:
            if fault is not None:
                raise OSError(
                    "0x%02x ACKs its address but reads fail (EIO) — a BUS/"
                    "wiring fault: add strong SDA/SCL pull-ups (2.2k-4.7k to "
                    "3V3), check a solid common GND, and re-seat SDA/SCL."
                    % fault
                )
            if seen is not None:
                raise OSError(
                    "0x%02x reports chip id 0x%02x, not a BME280 (0x60). "
                    "0x58=BMP280 (no humidity), 0x61=BME680." % seen
                )
            raise OSError(
                "BME280 not found at 0x76/0x77 — check wiring (SDA/SCL/3V3/"
                "GND) and run i2c.scan() to see what's on the bus"
            )
        self._load_calibration()
        # Humidity oversampling ×1 (must be written before ctrl_meas takes it).
        self._write8(_REG_CTRL_HUM, 0x01)
        # Temperature ×1, pressure ×1, normal mode (0b001_001_11 = 0x27).
        self._write8(_REG_CTRL_MEAS, 0x27)
        # t_standby = 1000 ms, IIR filter off (0b101_000_00 = 0xA0).
        self._write8(_REG_CONFIG, 0xA0)
        time.sleep_ms(50)  # let the first conversion complete

    # --- low-level I²C helpers ------------------------------------------------
    def _read(self, reg, n):
        return self.i2c.readfrom_mem(self.addr, reg, n)

    def _read8(self, reg):
        return self.i2c.readfrom_mem(self.addr, reg, 1)[0]

    def _write8(self, reg, val):
        self.i2c.writeto_mem(self.addr, reg, bytes([val]))

    # --- factory calibration (datasheet §4.2.2, Table 16) ---------------------
    def _load_calibration(self):
        c = self._read(_REG_CALIB_00, 26)
        (
            self.dig_T1, self.dig_T2, self.dig_T3,
            self.dig_P1, self.dig_P2, self.dig_P3, self.dig_P4, self.dig_P5,
            self.dig_P6, self.dig_P7, self.dig_P8, self.dig_P9,
        ) = ustruct.unpack("<HhhHhhhhhhhh", c[0:24])
        self.dig_H1 = c[25]  # 0xA1, unsigned char

        h = self._read(_REG_CALIB_26, 7)  # 0xE1..0xE7
        self.dig_H2, self.dig_H3 = ustruct.unpack("<hB", h[0:3])
        # dig_H4 / dig_H5 are signed 12-bit values packed across three bytes:
        #   0xE4 = H4[11:4], 0xE5 = H5[3:0]<<4 | H4[3:0], 0xE6 = H5[11:4]
        self.dig_H4 = _s12((h[3] << 4) | (h[4] & 0x0F))
        self.dig_H5 = _s12((h[5] << 4) | (h[4] >> 4))
        self.dig_H6 = ustruct.unpack("<b", h[6:7])[0]  # signed char

    # --- raw ADC read ---------------------------------------------------------
    def _read_raw(self):
        d = self._read(_REG_DATA, 8)
        raw_p = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4)
        raw_t = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4)
        raw_h = (d[6] << 8) | d[7]
        return raw_t, raw_p, raw_h

    # --- Bosch compensation formulas (datasheet §4.2.3, floating point) -------
    def _compensate_temp(self, raw_t):
        v1 = (raw_t / 16384.0 - self.dig_T1 / 1024.0) * self.dig_T2
        v2 = ((raw_t / 131072.0 - self.dig_T1 / 8192.0) ** 2) * self.dig_T3
        self.t_fine = v1 + v2
        return self.t_fine / 5120.0  # °C

    def _compensate_pressure(self, raw_p):
        v1 = self.t_fine / 2.0 - 64000.0
        v2 = v1 * v1 * self.dig_P6 / 32768.0
        v2 = v2 + v1 * self.dig_P5 * 2.0
        v2 = v2 / 4.0 + self.dig_P4 * 65536.0
        v1 = (self.dig_P3 * v1 * v1 / 524288.0 + self.dig_P2 * v1) / 524288.0
        v1 = (1.0 + v1 / 32768.0) * self.dig_P1
        if v1 == 0.0:
            return 0.0  # avoid division by zero
        p = 1048576.0 - raw_p
        p = (p - v2 / 4096.0) * 6250.0 / v1
        v1 = self.dig_P9 * p * p / 2147483648.0
        v2 = p * self.dig_P8 / 32768.0
        p = p + (v1 + v2 + self.dig_P7) / 16.0
        return p  # Pa

    def _compensate_humidity(self, raw_h):
        h = self.t_fine - 76800.0
        h = (raw_h - (self.dig_H4 * 64.0 + self.dig_H5 / 16384.0 * h)) * (
            self.dig_H2 / 65536.0 * (
                1.0 + self.dig_H6 / 67108864.0 * h * (
                    1.0 + self.dig_H3 / 67108864.0 * h
                )
            )
        )
        h = h * (1.0 - self.dig_H1 * h / 524288.0)
        if h > 100.0:
            h = 100.0
        elif h < 0.0:
            h = 0.0
        return h  # %RH

    # --- public API -----------------------------------------------------------
    def read(self):
        """Read the sensor and return ``(temperature °C, pressure hPa, humidity %RH)``."""
        raw_t, raw_p, raw_h = self._read_raw()
        temp = self._compensate_temp(raw_t)  # sets t_fine, needed by the others
        pressure = self._compensate_pressure(raw_p) / 100.0  # Pa → hPa
        humidity = self._compensate_humidity(raw_h)
        return temp, pressure, humidity

    @property
    def temperature(self):
        """Temperature in °C."""
        raw_t, _, _ = self._read_raw()
        return self._compensate_temp(raw_t)

    @property
    def pressure(self):
        """Barometric pressure in hPa (hectopascals)."""
        raw_t, raw_p, _ = self._read_raw()
        self._compensate_temp(raw_t)  # refresh t_fine before compensating
        return self._compensate_pressure(raw_p) / 100.0

    @property
    def pressure_pa(self):
        """Barometric pressure in Pa (pascals)."""
        raw_t, raw_p, _ = self._read_raw()
        self._compensate_temp(raw_t)
        return self._compensate_pressure(raw_p)

    @property
    def humidity(self):
        """Relative humidity in %RH."""
        raw_t, _, raw_h = self._read_raw()
        self._compensate_temp(raw_t)
        return self._compensate_humidity(raw_h)
