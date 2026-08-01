# SPDX-License-Identifier: MIT
"""PCF8563 real-time clock driver (Snakie module #120).

A small, self-contained MIT-licensed register driver for the NXP PCF8563 — the RTC
on Seeed's **XIAO Expansion Base** (and most cheap I²C clock breakouts), at address
``0x51``.

Usage on a board::

    from machine import I2C, Pin
    from pcf8563 import PCF8563

    # D4/D5 on a XIAO — the GPIOs behind those names are board-specific:
    #     RP2040 / RP2350   sda=Pin(6), scl=Pin(7)
    #     ESP32-S3          sda=Pin(5), scl=Pin(6)
    rtc = PCF8563(I2C(1, sda=Pin(5), scl=Pin(6)))   # XIAO ESP32-S3
    if rtc.unset():
        rtc.datetime((2026, 7, 30, 9, 30, 0, 3))   # Y, M, D, h, m, s, weekday
    print(rtc.datetime())

Every field is **BCD** with status bits sharing the same byte, so each one has to
be masked before decoding — the mask is not cosmetic. In particular the seconds
register's top bit is the **VL (voltage-low) flag**, not part of the seconds: read
it unmasked and you get times like ":83". :meth:`unset` exposes that flag, because
a PCF8563 whose backup cell has been flat is not slow — it is *lying*, and the only
honest answer is to re-set it.

The BCD conversions are pure, so they can be unit-tested under CPython without an
I²C bus.
"""

_DEFAULT_ADDR = 0x51

# Register map. The time block is 7 consecutive registers from 0x02.
_CTRL1 = 0x00
_CTRL2 = 0x01
_VL_SECONDS = 0x02

#: Per-register masks for the time block, in read order. Each register carries
#: status/padding bits alongside its BCD value and MUST be masked:
#:   0x02 seconds  bit 7  = VL (voltage-low) flag
#:   0x04 hours    bits 5-0 only
#:   0x05 days     bits 5-0 only
#:   0x06 weekday  bits 2-0 only
#:   0x07 months   bit 7  = century
_TIME_MASKS = (0x7F, 0x7F, 0x3F, 0x3F, 0x07, 0x1F, 0xFF)

#: The century the year register counts from (it holds 00..99).
CENTURY = 2000


def from_bcd(value):
    """Decode a packed BCD byte to an int (``0x59`` → ``59``). Pure."""
    return (value >> 4) * 10 + (value & 0x0F)


def to_bcd(value):
    """Encode an int 0..99 as a packed BCD byte (``59`` → ``0x59``). Pure."""
    v = int(value)
    if not 0 <= v <= 99:
        raise ValueError("BCD range is 0..99, got %r" % (value,))
    return ((v // 10) << 4) | (v % 10)


def decode_time(raw):
    """Decode the 7-byte time block to ``(year, month, day, hour, minute, second,
    weekday, unset)``. Pure.

    `raw` is registers ``0x02``..``0x08`` as read. ``unset`` is the VL flag: the
    clock lost power and the time is not trustworthy.
    """
    if raw is None or len(raw) < 7:
        raise ValueError("need 7 bytes of PCF8563 time registers")
    masked = [raw[i] & _TIME_MASKS[i] for i in range(7)]
    return (
        CENTURY + from_bcd(masked[6]),
        from_bcd(masked[5]),
        from_bcd(masked[3]),
        from_bcd(masked[2]),
        from_bcd(masked[1]),
        from_bcd(masked[0]),
        masked[4],
        bool(raw[0] & 0x80),
    )


def encode_time(year, month, day, hour, minute, second, weekday=0):
    """Encode a time into the 7 bytes written to ``0x02``..``0x08``. Pure.

    Writing seconds also clears the VL flag (its bit is left at 0), which is what
    marks the clock as trustworthy again.
    """
    return bytes(
        [
            to_bcd(second),  # bit 7 = 0 clears VL
            to_bcd(minute),
            to_bcd(hour),
            to_bcd(day),
            int(weekday) & 0x07,
            to_bcd(month),  # bit 7 (century) left clear
            to_bcd(int(year) - CENTURY),
        ]
    )


class PCF8563:
    """Driver for a PCF8563 real-time clock on an I²C bus."""

    def __init__(self, i2c, addr=_DEFAULT_ADDR):
        self._i2c = i2c
        self._addr = addr

    def _read_block(self):
        return self._i2c.readfrom_mem(self._addr, _VL_SECONDS, 7)

    def datetime(self, value=None):
        """Get or set the time.

        With no argument, returns ``(year, month, day, hour, minute, second,
        weekday)``. Pass that same tuple to SET the clock (``weekday`` optional).
        """
        if value is None:
            y, mo, d, h, mi, s, wd, _unset = decode_time(self._read_block())
            return (y, mo, d, h, mi, s, wd)
        y, mo, d, h, mi, s = value[:6]
        wd = value[6] if len(value) > 6 else 0
        self._i2c.writeto_mem(self._addr, _VL_SECONDS, encode_time(y, mo, d, h, mi, s, wd))
        return self.datetime()

    def unset(self):
        """True when the VL flag is set — the clock lost power, so the time is junk.

        Check this before trusting a reading. A flat backup cell does not make the
        clock slow, it makes it wrong.
        """
        return bool(self._read_block()[0] & 0x80)

    def start(self):
        """Start the clock (clear the STOP bit in Control_status_1)."""
        self._i2c.writeto_mem(self._addr, _CTRL1, b"\x00")

    def stop(self):
        """Stop the clock (set the STOP bit) — the registers hold their values."""
        self._i2c.writeto_mem(self._addr, _CTRL1, b"\x20")

    def clear_alarms(self):
        """Clear the alarm/timer interrupt flags in Control_status_2."""
        self._i2c.writeto_mem(self._addr, _CTRL2, b"\x00")

    def isoformat(self):
        """The current time as ``YYYY-MM-DD HH:MM:SS`` — handy for a log line."""
        y, mo, d, h, mi, s = self.datetime()[:6]
        return "%04d-%02d-%02d %02d:%02d:%02d" % (y, mo, d, h, mi, s)
